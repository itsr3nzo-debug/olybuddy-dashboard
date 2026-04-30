/**
 * GET /api/mobile/billing/subscription
 * Returns the current subscription status + plan + period end.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const sb = createUntypedServiceClient()
    const [client, todayBudget] = await Promise.all([
      sb
        .from('clients')
        .select(
          'plan, subscription_status, current_period_end, cancel_at_period_end, trial_ends_at'
        )
        .eq('id', clientId)
        .maybeSingle(),
      sb
        .from('llm_budget_periods')
        .select('spent_pence, cap_pence')
        .eq('client_id', clientId)
        .eq('period_start', new Date().toISOString().slice(0, 10))
        .maybeSingle(),
    ])

    return jsonResponse(
      {
        ...(client.data ?? {}),
        usage_today: todayBudget.data ?? { spent_pence: 0, cap_pence: 0 },
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
