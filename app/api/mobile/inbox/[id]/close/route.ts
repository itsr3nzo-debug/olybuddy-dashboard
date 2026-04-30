/**
 * POST /api/mobile/inbox/[id]/close
 * Mark a conversation as closed. Owner does this when the deal completes
 * or the customer goes silent.
 *
 * Body: { reason?: string }
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

    const body = (await request.json().catch(() => ({}))) as { reason?: string }

    const sb = createUntypedServiceClient()

    const { error } = await sb
      .from('conversation_sessions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_reason: body.reason ?? null,
        ai_paused: true,
      })
      .eq('id', id)
      .eq('client_id', clientId)
    if (error) throw Errors.internal(error.message)

    return jsonResponse({ ok: true, status: 'closed' }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
