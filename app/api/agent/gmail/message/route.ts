/**
 * GET /api/agent/gmail/message?id=<messageId>&mode=full
 *
 * Fetch a single Gmail message by ID with full payload (incl. attachmentList).
 * Used by the two-pass scan optimization — after the cheap metadata list
 * classifies an email as `supplier_invoice`, the action skill calls this
 * endpoint to pull the one message's attachmentId so /api/agent/gmail/attachment
 * can grab the PDF.
 *
 * Gated by the same regex as /attachment — only URL-safe-base64 ids.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { createClient } from '@supabase/supabase-js'

interface ComposioResponse {
  successful?: boolean
  data?: {
    messageId?: string
    threadId?: string
    sender?: string
    to?: string
    subject?: string
    messageText?: string
    preview?: { body?: string } | string
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
  error?: string
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const messageId = url.searchParams.get('id')
  if (!messageId || !/^[A-Za-z0-9_-]{5,200}$/.test(messageId)) {
    return NextResponse.json({ error: 'malformed id' }, { status: 400 })
  }

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
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 409 })
  }

  const res = await fetch(
    `https://backend.composio.dev/api/v3/actions/GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID/execute`,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPOSIO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        entity_id: auth.clientId,
        params: {
          user_id: 'me',
          message_id: messageId,
          // Composio's single-message fetch accepts format: 'FULL' | 'METADATA' | 'MINIMAL'
          format: 'FULL',
        },
      }),
    },
  ).catch(e => ({ ok: false, error: e } as { ok: false; error: unknown }))

  if (!('ok' in res) || !res.ok) {
    return NextResponse.json(
      { error: 'Composio call failed', detail: safeErrorDetail((res as { error?: unknown }).error ?? res) },
      { status: 502 },
    )
  }

  const payload = (await res.json()) as ComposioResponse
  if (!payload.successful || !payload.data) {
    return NextResponse.json(
      { error: 'Gmail fetch failed', detail: safeErrorDetail(payload.error) },
      { status: 502 },
    )
  }

  const m = payload.data
  // Drop raw message body (injection safety); keep metadata + attachment ids.
  const preview =
    typeof m.preview === 'string'
      ? m.preview
      : (m.preview?.body ?? '').slice(0, 500)
  let receivedMs = NaN
  if (m.messageTimestamp) {
    const n = parseInt(m.messageTimestamp, 10)
    if (!isNaN(n)) receivedMs = n > 1e12 ? n : n * 1000
  }
  const MIN_MS = Date.UTC(2020, 0, 1)
  const MAX_MS = Date.now() + 24 * 3600 * 1000
  if (receivedMs < MIN_MS || receivedMs > MAX_MS) receivedMs = NaN

  return NextResponse.json({
    email: {
      id: m.messageId ?? '',
      thread_id: m.threadId ?? '',
      from: m.sender ?? '',
      to: m.to ?? '',
      subject: (m.subject ?? '').slice(0, 200),
      snippet: preview,
      received_iso: !isNaN(receivedMs) ? new Date(receivedMs).toISOString() : '',
      labels: m.labelIds ?? [],
      attachments: (m.attachmentList ?? []).map(a => ({
        filename: a.filename ?? '',
        mime_type: a.mimeType ?? '',
        size_bytes: a.size ?? 0,
        attachment_id: a.attachmentId ?? '',
        part_id: a.partId ?? '',
      })),
    },
  })
}
