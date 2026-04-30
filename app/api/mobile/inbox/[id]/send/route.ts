/**
 * POST /api/mobile/inbox/[id]/send
 *
 * Owner sends a manual reply to the customer thread. Inserts an outbound
 * comms_log row + triggers the per-VPS Baileys/Twilio adapter to actually
 * deliver it (via Supabase Realtime — VPS subscribes to comms_log inserts
 * with direction='outbound' and dispatches over WhatsApp/SMS).
 *
 * Body: { content: string, channel?: 'whatsapp' | 'sms' }
 * Headers: Idempotency-Key recommended
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { withIdempotency } from '@/lib/middleware/idempotency'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    const bodyText = await request.text()
    let body: { content?: string; channel?: 'whatsapp' | 'sms' }
    try {
      body = bodyText ? JSON.parse(bodyText) : {}
    } catch {
      throw Errors.validation({ body: 'Invalid JSON body' })
    }
    if (!body.content || body.content.trim().length === 0) {
      throw Errors.validation({ field: 'content' })
    }

    const sb = createUntypedServiceClient()

    // Verify conversation ownership
    const conv = await sb
      .from('conversation_sessions')
      .select('id, channel')
      .eq('id', id)
      .eq('client_id', clientId)
      .maybeSingle()
    if (!conv.data) throw Errors.notFound('Conversation not found.')

    const channel = body.channel ?? (conv.data.channel as string) ?? 'whatsapp'

    const { result } = await withIdempotency(
      { request, endpoint: 'mobile.inbox.send', userId: claims.sub, bodyText },
      async () => {
        const ins = await sb
          .from('comms_log')
          .insert({
            client_id: clientId,
            conversation_id: id,
            direction: 'outbound',
            body: body.content!.trim(),
            channel,
            metadata: { sent_by: claims.sub, source: 'mobile_takeover' },
          })
          .select('id, created_at')
          .single()
        if (ins.error) throw Errors.internal(ins.error.message)
        return {
          status: 200,
          body: { message_id: ins.data.id, created_at: ins.data.created_at, status: 'queued' },
        }
      }
    )

    return jsonResponse(result.body, { status: result.status, requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
