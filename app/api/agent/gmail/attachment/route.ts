/**
 * GET /api/agent/gmail/attachment?message_id=<id>&attachment_id=<id>
 *
 * Fetches a single Gmail attachment's raw bytes for the authenticated agent's
 * client. Called by /extract-supplier-invoice-from-pdf AFTER the owner has
 * approved a `supplier_invoice` signal — never unprompted, never before the
 * owner has sanctioned reading the attachment.
 *
 * Uses Composio's verified `GMAIL_GET_ATTACHMENT` action.
 *
 * Returns raw bytes as application/octet-stream so the caller can pipe
 * directly into vision-claude / pdf-parse / wherever. Max 10 MB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { createClient } from '@supabase/supabase-js'

interface ComposioAttachmentResponse {
  successful?: boolean
  data?: {
    size?: number
    data?: string          // base64url-encoded attachment bytes
    attachmentId?: string
  }
  error?: string
}

const MAX_BYTES = 10 * 1024 * 1024

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const messageId = url.searchParams.get('message_id')
  const attachmentId = url.searchParams.get('attachment_id')
  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: 'message_id and attachment_id required' }, { status: 400 })
  }
  // Gmail message IDs + attachment IDs are strictly in the URL-safe Base64
  // alphabet (A-Z a-z 0-9 - _) plus length constraints. We hard-validate
  // here to block SQL-wildcard / ilike-pattern injection (% _) when we look
  // the signal up below — a rogue agent cannot pass `%` to match all
  // signals or fetch arbitrary attachments.
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(messageId) || !/^[A-Za-z0-9_-]{5,500}$/.test(attachmentId)) {
    return NextResponse.json({ error: 'malformed message_id or attachment_id' }, { status: 400 })
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

  // The owner-approval gate: must have an `owner_approved` signal whose
  // source_ref EXACTLY equals `gmail:<messageId>`. Using `.eq()` (not `.ilike()`)
  // so SQL wildcards can't be abused. messageId has already been regex-validated
  // above, belt-and-braces.
  const { data: approved } = await sb
    .from('integration_signals')
    .select('signal_id, proposed_action')
    .eq('client_id', auth.clientId)
    .eq('status', 'owner_approved')
    .eq('source_ref', `gmail:${messageId}`)
    .limit(1)
    .maybeSingle()
  if (!approved) {
    return NextResponse.json(
      { error: 'No owner-approved signal references this message', detail: 'Attachments can only be fetched for signals the owner has explicitly approved.' },
      { status: 403 },
    )
  }

  const composioRes = await fetch(
    `https://backend.composio.dev/api/v3/actions/GMAIL_GET_ATTACHMENT/execute`,
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
          attachment_id: attachmentId,
        },
      }),
    },
  ).catch(e => ({ ok: false, error: e } as { ok: false; error: unknown }))

  if (!('ok' in composioRes) || !composioRes.ok) {
    return NextResponse.json(
      { error: 'Composio call failed', detail: safeErrorDetail((composioRes as { error?: unknown }).error ?? composioRes) },
      { status: 502 },
    )
  }

  const payload = (await composioRes.json()) as ComposioAttachmentResponse
  if (!payload.successful || !payload.data?.data) {
    return NextResponse.json(
      { error: 'Attachment fetch failed', detail: safeErrorDetail(payload.error) },
      { status: 502 },
    )
  }

  const size = payload.data.size ?? 0
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Attachment too large', detail: `${size} bytes exceeds ${MAX_BYTES} bytes limit` },
      { status: 413 },
    )
  }

  // Decode base64url → bytes
  const b64url = payload.data.data
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'))

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      'cache-control': 'private, no-store',
    },
  })
}
