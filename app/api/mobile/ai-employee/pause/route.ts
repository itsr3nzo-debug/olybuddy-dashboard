/**
 * POST /api/mobile/ai-employee/pause
 * Body: { until?: ISO timestamp }   — null/missing = indefinite
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

    const body = (await request.json().catch(() => ({}))) as { until?: string | null }

    const sb = createUntypedServiceClient()
    const { error } = await sb
      .from('agent_config')
      .update({
        paused: true,
        paused_until: body.until ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', clientId)
    if (error) throw Errors.internal(error.message)
    return jsonResponse({ ok: true, paused: true, paused_until: body.until ?? null }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
