/**
 * POST /api/mobile/inbox/[id]/hand-back
 * Owner re-enables the AI on a conversation they previously took over.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
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

    const sb = createUntypedServiceClient()

    const { data, error } = await sb.rpc('hand_back_conversation', {
      p_conversation_id: id,
      p_user_id: claims.sub,
      p_client_id: clientId,
    })
    if (error) throw Errors.internal(error.message)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw Errors.notFound('Conversation not found.')

    return jsonResponse({ ok: true, ai_paused: false }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
