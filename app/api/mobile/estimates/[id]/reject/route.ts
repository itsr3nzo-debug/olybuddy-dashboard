/**
 * POST /api/mobile/estimates/[id]/reject
 *
 * Owner rejects an AI-drafted estimate. Doesn't send anything to the
 * customer; just marks it rejected so it disappears from the queue.
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

    const { data, error } = await sb
      .from('estimates')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: claims.sub,
        rejection_reason: body.reason ?? null,
      })
      .eq('id', id)
      .eq('client_id', clientId)
      .select('id, status')
      .maybeSingle()
    if (error) throw Errors.internal(error.message)
    if (!data) throw Errors.notFound('Estimate not found.')
    return jsonResponse({ ok: true, status: data.status }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
