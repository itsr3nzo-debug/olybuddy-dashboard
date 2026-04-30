/**
 * GET /api/mobile/jobs/[id]
 * Single opportunity detail.
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

    const { data, error } = await sb
      .from('opportunities')
      .select('*')
      .eq('id', id)
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) throw Errors.internal(error.message)
    if (!data) throw Errors.notFound('Job not found.')

    let contact = null
    if (data.contact_id) {
      const c = await sb
        .from('contacts')
        .select('id, name, phone, email')
        .eq('id', data.contact_id)
        .eq('client_id', clientId)
        .maybeSingle()
      contact = c.data
    }

    return jsonResponse({ job: data, contact }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
