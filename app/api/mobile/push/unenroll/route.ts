/**
 * POST /api/mobile/push/unenroll
 *
 * Removes a device from push delivery. Called on:
 *   - explicit user toggle in Settings
 *   - app uninstall (best-effort — Apple/Google notify us via OneSignal webhook
 *     for soft-bounces; we treat this endpoint as a "user-initiated" path)
 *   - sign-out (called as part of the sign-out cleanup)
 *
 * Body: { onesignal_subscription_id: string }
 *
 * We don't delete the OneSignal subscription itself — that's the app's job
 * (OneSignal SDK on the device knows how to clean itself up). We just remove
 * our record so we don't try to push to it.
 */

import { requireAuth } from '@/lib/auth/claims'
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
      | { onesignal_subscription_id?: string }
      | null
    if (!body?.onesignal_subscription_id) {
      throw Errors.validation({ field: 'onesignal_subscription_id' })
    }

    const sb = createUntypedServiceClient()

    const { error } = await sb
      .from('push_subscriptions')
      .delete()
      .eq('user_id', claims.sub)
      .eq('onesignal_subscription_id', body.onesignal_subscription_id)
    if (error) throw Errors.internal(error.message)

    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
