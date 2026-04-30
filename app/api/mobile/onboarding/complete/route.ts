/**
 * POST /api/mobile/onboarding/complete
 *
 * Marks the user as onboarded — called after they've reached the end of the
 * first-run flow (AI consent → biometric → notifications). Sets
 * `clients.mobile_onboarded_at` so we don't re-show the flow on next launch.
 *
 * Body: { biometric_enabled: boolean, push_enabled: boolean }
 *
 * The booleans are stored on the client row for product analytics; the
 * actual biometric enrollment lives client-side (expo-local-authentication)
 * and the push subscription lives in `push_subscriptions`.
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

    const body = (await request.json().catch(() => null)) as
      | { biometric_enabled?: boolean; push_enabled?: boolean }
      | null

    if (!body) throw Errors.validation({ message: 'JSON body required' })

    const clientId = getClientIdFromClaims(claims)
    const sb = createUntypedServiceClient()

    // Verify AI consent was given first — defence in depth, also caught on
    // /api/chat/* routes, but don't let users bypass by skipping straight
    // to /complete.
    const { data: client } = await sb
      .from('clients')
      .select('ai_consent_at')
      .eq('id', clientId)
      .maybeSingle()
    if (!client?.ai_consent_at) throw Errors.consentRequired()

    const { error } = await sb
      .from('clients')
      .update({ mobile_onboarded_at: new Date().toISOString() })
      .eq('id', clientId)
    if (error) throw Errors.internal(error.message)

    // Telemetry event — used to track onboarding funnel
    await sb.from('mobile_telemetry').insert({
      user_id: claims.sub,
      client_id: clientId,
      event_name: 'onboarding_completed',
      properties: {
        biometric_enabled: body.biometric_enabled ?? false,
        push_enabled: body.push_enabled ?? false,
      },
      occurred_at: new Date().toISOString(),
    })

    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
