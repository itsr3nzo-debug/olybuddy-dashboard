/**
 * POST /api/mobile/ai-employee/resume
 * Resumes a paused AI Employee.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const sb = createUntypedServiceClient()
    const { error } = await sb
      .from('agent_config')
      .update({ paused: false, paused_until: null, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)
    if (error) throw Errors.internal(error.message)
    return jsonResponse({ ok: true, paused: false }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
