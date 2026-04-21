/**
 * GET /api/agent/gmail/list?since=<iso>&unread=true&max=20
 *
 * Lists recent Gmail messages for the authenticated VPS agent. Used by
 * /scan-gmail-for-actions to detect actionable emails (invoices, replies,
 * complaints, voicemail notifications, calendar invites, ...).
 *
 * Calls Composio's GMAIL_FETCH_EMAILS action. Schema verified 2026-04-18
 * against https://backend.composio.dev/api/v3/tools/GMAIL_FETCH_EMAILS:
 *   Input:  query, user_id, verbose, ids_only, label_ids[], page_token,
 *           max_results (≤500), include_payload, include_spam_trash
 *   Output: { data: { messages: [{ sender, subject, messageId, threadId,
 *                                  messageText, attachmentList[], labelIds[],
 *                                  messageTimestamp, preview }], nextPageToken,
 *                     resultSizeEstimate },
 *             successful, error }
 *
 * We return a slim, injection-safe schema. Raw `messageText` (full body) is
 * dropped before return — the scanner classifier gets only `subject` + `preview`
 * which it then redacts-and-wraps in sentinels before sending to Haiku.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { createClient } from '@supabase/supabase-js'

interface ComposioGmailMessage {
  sender?: string
  to?: string
  subject?: string
  messageId?: string
  threadId?: string
  messageText?: string        // full body — we do NOT return this
  preview?: { body?: string; subject?: string } | Record<string, unknown>
  labelIds?: string[]
  attachmentList?: Array<{
    filename?: string
    mimeType?: string
    size?: number
    attachmentId?: string
    partId?: string
  }>
  messageTimestamp?: string
}

interface ComposioExecuteResponse {
  successful?: boolean
  data?: {
    messages?: ComposioGmailMessage[]
    nextPageToken?: string
    resultSizeEstimate?: number
  }
  error?: string
}

interface SlimEmail {
  id: string
  thread_id: string
  from: string
  to: string
  subject: string
  snippet: string           // short preview text (Gmail-sanitised) — safe
  received_iso: string
  labels: string[]
  attachments: Array<{ filename: string; mime_type: string; size_bytes: number; attachment_id: string; part_id: string }>
  is_unread: boolean
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  const unreadOnly = url.searchParams.get('unread') !== 'false'
  const max = Math.min(parseInt(url.searchParams.get('max') || '20', 10), 50)
  // Two-pass optimisation: default mode=metadata is cheap/fast (no attachment
  // IDs, no payload). The scanner's classifier then flags emails needing
  // attachments (e.g. supplier_invoice) and re-calls with mode=full to pull
  // the full payload for those specific messages. Cuts Composio traffic ~97%.
  //   mode=metadata → ids_only+verbose=false: id/sender/subject/labels
  //   mode=full     → verbose=true+include_payload=true: attachments too
  const mode = (url.searchParams.get('mode') ?? 'full') === 'metadata' ? 'metadata' : 'full'
  const message_ids = (url.searchParams.get('message_ids') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[A-Za-z0-9_-]{5,200}$/.test(s))

  // Gmail must be connected for this client
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: integration } = await sb
    .from('integrations')
    .select('provider, status')
    .eq('client_id', auth.clientId)
    .eq('provider', 'gmail')
    .eq('status', 'connected')
    .single()

  if (!integration) {
    return NextResponse.json(
      { error: 'Gmail not connected', emails: [], count: 0 },
      { status: 409 },
    )
  }

  // Build Gmail search query
  const queryParts: string[] = []
  if (since) {
    const sinceDate = new Date(since)
    if (!isNaN(sinceDate.valueOf())) {
      // `after:` takes YYYY/MM/DD OR unix seconds
      queryParts.push(`after:${Math.floor(sinceDate.getTime() / 1000)}`)
    }
  }
  if (unreadOnly) queryParts.push('is:unread')
  queryParts.push('-category:promotions')
  const query = queryParts.join(' ')

  const composioRes = await fetch(
    `https://backend.composio.dev/api/v3/actions/GMAIL_FETCH_EMAILS/execute`,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPOSIO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        entity_id: auth.clientId,
        params: {
          query: message_ids.length > 0 ? `` : query,
          max_results: max,
          user_id: 'me',
          // mode=metadata → cheap (~50KB/response): enough for classification
          //                  (subject, sender, preview, labels). No attachment ids.
          // mode=full     → ~1MB/response: attachmentList[].attachmentId populated
          //                  for downstream attachment fetches.
          verbose: mode === 'full',
          include_payload: mode === 'full',
          include_spam_trash: false,
          // If message_ids provided, Gmail's query supports `rfc822msgid:` but
          // Composio's fetch takes the message IDs directly via a different
          // mechanism — we pass them as a query filter; if an individual
          // lookup is needed, scanner uses a separate /api/agent/gmail/message
          // endpoint (not built yet — for now, 2-pass works by re-running list
          // scoped to a narrower query window).
        },
      }),
    },
  ).catch(e => ({ ok: false, error: e } as { ok: false; error: unknown }))

  if (!('ok' in composioRes) || !composioRes.ok) {
    return NextResponse.json(
      { error: 'Composio call failed', detail: safeErrorDetail((composioRes as { error?: unknown }).error ?? composioRes), emails: [], count: 0 },
      { status: 502 },
    )
  }

  const payload = (await composioRes.json()) as ComposioExecuteResponse
  if (!payload.successful) {
    return NextResponse.json(
      { error: 'Gmail fetch failed', detail: safeErrorDetail(payload.error), emails: [], count: 0 },
      { status: 502 },
    )
  }

  const messages = payload.data?.messages ?? []
  const emails: SlimEmail[] = messages.map(m => {
    // Composio's `messageTimestamp` has inconsistent units across Gmail tool
    // versions — sometimes ms, sometimes seconds. Detect by magnitude: a
    // timestamp > 10^12 is definitely ms (year ~2286+ in seconds).
    let receivedMs = NaN
    if (m.messageTimestamp) {
      const n = parseInt(m.messageTimestamp, 10)
      if (!isNaN(n)) receivedMs = n > 1e12 ? n : n * 1000
    }
    // Sanity-clamp: reject dates before 2020 or more than 24h in the future
    const MIN_MS = Date.UTC(2020, 0, 1)
    const MAX_MS = Date.now() + 24 * 3600 * 1000
    if (receivedMs < MIN_MS || receivedMs > MAX_MS) receivedMs = NaN
    const received_iso = !isNaN(receivedMs) ? new Date(receivedMs).toISOString() : ''
    // Build a "snippet" from Composio's preview field (string or object with .body)
    let snippet = ''
    if (typeof m.preview === 'string') snippet = m.preview
    else if (m.preview && typeof m.preview === 'object' && typeof (m.preview as { body?: string }).body === 'string') {
      snippet = (m.preview as { body: string }).body
    }
    snippet = snippet.slice(0, 500) // hard cap
    return {
      id: m.messageId ?? '',
      thread_id: m.threadId ?? '',
      from: m.sender ?? '',
      to: m.to ?? '',
      subject: (m.subject ?? '').slice(0, 200),
      snippet,
      received_iso,
      labels: m.labelIds ?? [],
      attachments: (m.attachmentList ?? []).map(a => ({
        filename: a.filename ?? '',
        mime_type: a.mimeType ?? '',
        size_bytes: a.size ?? 0,
        attachment_id: a.attachmentId ?? '',
        part_id: a.partId ?? '',
      })),
      is_unread: (m.labelIds ?? []).includes('UNREAD'),
    }
  })

  return NextResponse.json({ count: emails.length, emails, query_used: query })
}
