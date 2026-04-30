/**
 * POST /api/mobile/notifications/[id]/read
 * Marks one notification as read. Idempotent.
 */

import { requireAuth } from '@/lib/auth/claims'
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

    const { id } = await params

    const sb = createUntypedServiceClient()

    const { data, error } = await sb
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', claims.sub)
      .is('read_at', null) // only update if not already read — idempotent
      .select('id')
      .maybeSingle()

    if (error) throw Errors.internal(error.message)
    if (!data) {
      // Either not found or already read — return ok either way (idempotent)
    }
    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
