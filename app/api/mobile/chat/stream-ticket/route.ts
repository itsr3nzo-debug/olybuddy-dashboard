/**
 * POST /api/mobile/chat/stream-ticket
 *
 * Returns a short-lived (60s) single-use ticket the mobile app can use to
 * authenticate the SSE EventSource at /api/chat/stream/[id]?ticket=...
 *
 * Why: EventSource cannot send headers, so the only way to authenticate is
 * via URL query string. JWTs in URLs leak via Vercel logs, browser history,
 * proxies, and Sentry breadcrumbs. A short-lived single-use ticket bound to
 * a specific resource_id (conversation) caps the blast radius.
 *
 * Body: { conversation_id: string, assistant_message_id: string }
 * Response: { ticket: string, expires_at: ISO }
 */

import crypto from 'node:crypto'
import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

const TICKET_TTL_SEC = 60

interface Body {
  conversation_id?: string
  assistant_message_id?: string
}

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('chat_send', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.conversation_id) throw Errors.validation({ field: 'conversation_id' })
    if (!body.assistant_message_id) throw Errors.validation({ field: 'assistant_message_id' })

    const sb = createUntypedServiceClient()

    // Verify the conversation belongs to this user's client_id BEFORE issuing
    // a ticket — prevents a malicious user from reading other tenants' streams.
    const sess = await sb
      .from('agent_chat_sessions')
      .select('id, client_id')
      .eq('id', body.conversation_id)
      .maybeSingle()
    if (!sess.data || sess.data.client_id !== clientId) {
      throw Errors.notFound('Conversation not found.')
    }

    const ticket = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + TICKET_TTL_SEC * 1000)

    const { error } = await sb.from('sse_tickets').insert({
      ticket,
      user_id: claims.sub,
      client_id: clientId,
      scope: 'chat_stream',
      // Bind to BOTH conversation_id and assistant_message_id by joining them —
      // ticket only valid for one specific message stream.
      resource_id: `${body.conversation_id}:${body.assistant_message_id}`,
      expires_at: expiresAt.toISOString(),
    })
    if (error) throw Errors.internal(error.message)

    return jsonResponse({ ticket, expires_at: expiresAt.toISOString() }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
