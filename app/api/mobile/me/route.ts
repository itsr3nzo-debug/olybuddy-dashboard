/**
 * GET /api/mobile/me
 *
 * Returns the augmented session profile that the mobile app caches in memory:
 * user identity + client_id + role + onboarding state + AI Employee config.
 *
 * Mobile signs in directly via Supabase (no proxy — DA dropped that). After
 * sign-in the app calls this once to hydrate. Re-called on cold start to
 * refresh anything that may have changed (e.g. AI Employee renamed in
 * Settings).
 *
 * Auth: Supabase JWT in Authorization: Bearer
 * Rate-limit tier: reads
 */

import { requireAuth, getClientIdFromClaims, isSuperAdmin } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)

    // Super-admin without a pinned client gets a sentinel response — mobile
    // should redirect them to a "pick a client" screen rather than render
    // dashboard chrome.
    const isAdmin = isSuperAdmin(claims)
    const clientId = isAdmin
      ? claims.app_metadata?.client_id ?? null
      : getClientIdFromClaims(claims)

    const sb = createUntypedServiceClient()

    // M7 fix — both client and agent_config queries gate on clientId. Previous
    // code only gated the client query, which let agent_config run with a
    // null clientId and silently match `client_id IS NULL` rows.
    const [clientRow, agentConfigRow, prefsRow] = await Promise.all([
      clientId
        ? sb
            .from('clients')
            .select(
              'id, slug, name, contact_name, phone, email_verified_at, ai_consent_at, ai_consent_version, mobile_onboarded_at, subscription_status, subscription_plan, vps_status, vps_ready, trial_ends_at'
            )
            .eq('id', clientId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      clientId
        ? sb
            .from('agent_config')
            .select('agent_name, tone, hours, personality_prompt, paused, paused_until')
            .eq('client_id', clientId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sb
        .from('notification_preferences')
        .select('escalation, customer_reply, daily_digest, estimate_actions, digest_local_hour, timezone')
        .eq('user_id', claims.sub)
        .maybeSingle(),
    ])

    return jsonResponse(
      {
        user: {
          id: claims.sub,
          email: claims.email,
          role: claims.app_metadata?.role ?? 'member',
        },
        client: clientRow.data
          ? {
              id: clientRow.data.id,
              slug: clientRow.data.slug,
              name: clientRow.data.name,
              contact_name: clientRow.data.contact_name,
              phone: clientRow.data.phone,
              email_verified: !!clientRow.data.email_verified_at,
              ai_consented: !!clientRow.data.ai_consent_at,
              ai_consent_version: clientRow.data.ai_consent_version,
              onboarded: !!clientRow.data.mobile_onboarded_at,
              subscription_status: clientRow.data.subscription_status,
              plan: clientRow.data.subscription_plan,
              trial_ends_at: clientRow.data.trial_ends_at,
              vps_status: clientRow.data.vps_status,
              vps_ready: !!clientRow.data.vps_ready,
            }
          : null,
        ai_employee: agentConfigRow.data
          ? {
              name: agentConfigRow.data.agent_name ?? 'Ava',
              tone: agentConfigRow.data.tone,
              working_hours: agentConfigRow.data.hours,
              instructions: agentConfigRow.data.personality_prompt,
              paused: !!agentConfigRow.data.paused,
              paused_until: agentConfigRow.data.paused_until,
            }
          : null,
        notification_preferences: prefsRow.data ?? {
          escalation: true,
          customer_reply: true,
          daily_digest: true,
          estimate_actions: true,
          digest_local_hour: 17,
          timezone: 'Europe/London',
        },
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
