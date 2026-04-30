/**
 * GET /api/mobile/estimates/[id]
 * Single estimate detail (line items, customer, AI reasoning).
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    const sb = createUntypedServiceClient()

    const [estimate, contact] = await Promise.all([
      sb.from('estimates').select('*').eq('id', id).eq('client_id', clientId).maybeSingle(),
      // Defer contact join — fetch separately so we can null-safe even without FK
      Promise.resolve(null),
    ])
    if (!estimate.data) throw Errors.notFound('Estimate not found.')

    let contactRow = null
    if (estimate.data.contact_id) {
      const c = await sb
        .from('contacts')
        .select('id, name, phone, email')
        .eq('id', estimate.data.contact_id)
        .eq('client_id', clientId)
        .maybeSingle()
      contactRow = c.data
    }

    void contact // unused — kept so type names line up

    return jsonResponse(
      {
        estimate: estimate.data,
        contact: contactRow,
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
