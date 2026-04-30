/**
 * POST /api/mobile/push/enroll
 *
 * Called after the mobile app has registered with OneSignal and obtained a
 * subscription id. We:
 *   1. Insert/update push_subscriptions row (one per device)
 *   2. Tell OneSignal to alias this subscription with our user_id (external_id)
 *      so push.send keyed by external_id fans out to every device the user
 *      has signed in on.
 *
 * Body: {
 *   onesignal_subscription_id: string,
 *   platform: 'ios' | 'android',
 *   app_version?: string,
 *   device_model?: string,
 * }
 *
 * Idempotent — calling twice with the same subscription id updates last_seen.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { aliasSubscription } from '@/lib/push/onesignal'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


interface EnrollBody {
  onesignal_subscription_id?: string
  platform?: string
  app_version?: string
  device_model?: string
}

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('push_enroll', claims.sub)

    const body = (await request.json().catch(() => null)) as EnrollBody | null
    if (!body?.onesignal_subscription_id) {
      throw Errors.validation({ field: 'onesignal_subscription_id' })
    }
    if (body.platform !== 'ios' && body.platform !== 'android') {
      throw Errors.validation({ field: 'platform', allowed: ['ios', 'android'] })
    }

    const clientId = getClientIdFromClaims(claims)
    const sb = createUntypedServiceClient()

    // Upsert by (user_id, onesignal_subscription_id) — unique constraint
    const { error: upsertErr } = await sb
      .from('push_subscriptions')
      .upsert(
        {
          user_id: claims.sub,
          client_id: clientId,
          onesignal_subscription_id: body.onesignal_subscription_id,
          platform: body.platform,
          app_version: body.app_version ?? null,
          device_model: body.device_model ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,onesignal_subscription_id' }
      )

    if (upsertErr) throw Errors.internal(upsertErr.message)

    // Alias with OneSignal — failure here doesn't fail the enroll because the
    // subscription is recorded and will sync next time. We log loudly though.
    try {
      await aliasSubscription(body.onesignal_subscription_id, claims.sub)
    } catch (err) {
      console.error('[push/enroll] OneSignal alias failed (non-fatal):', err)
    }

    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
