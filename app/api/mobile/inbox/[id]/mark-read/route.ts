/**
 * POST /api/mobile/inbox/[id]/mark-read
 * Reset the unread_count on a customer conversation. Idempotent.
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

    const { error } = await sb
      .from('conversation_sessions')
      .update({ unread_count: 0, last_read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('client_id', clientId)
    if (error) throw Errors.internal(error.message)

    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
