/**
 * GET  /api/mobile/notifications/preferences   — read user's pref row
 * PATCH /api/mobile/notifications/preferences  — update fields
 *
 * The first read will lazily insert the default row if missing so the
 * mobile app never has to special-case "no prefs yet". PATCH is partial —
 * only the keys provided get updated.
 */

import { requireAuth } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


const DEFAULTS = {
  escalation: true,
  customer_reply: true,
  estimate_actions: true,
  daily_digest: true,
  digest_local_hour: 17,
  timezone: 'Europe/London',
  quiet_hours_start: null as number | null,
  quiet_hours_end: null as number | null,
}

interface PrefsBody {
  escalation?: boolean
  customer_reply?: boolean
  estimate_actions?: boolean
  daily_digest?: boolean
  digest_local_hour?: number
  timezone?: string
  quiet_hours_start?: number | null
  quiet_hours_end?: number | null
}

export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)

    const sb = createUntypedServiceClient()

    let { data } = await sb
      .from('notification_preferences')
      .select('*')
      .eq('user_id', claims.sub)
      .maybeSingle()

    if (!data) {
      // Lazy-create default row
      const insert = await sb
        .from('notification_preferences')
        .insert({ user_id: claims.sub, ...DEFAULTS })
        .select('*')
        .single()
      data = insert.data
    }

    return jsonResponse(data ?? DEFAULTS, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

export async function PATCH(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)

    const body = (await request.json().catch(() => null)) as PrefsBody | null
    if (!body || Object.keys(body).length === 0) {
      throw Errors.validation({ message: 'At least one field required.' })
    }

    // Validate hour fields
    for (const k of ['digest_local_hour', 'quiet_hours_start', 'quiet_hours_end'] as const) {
      const v = body[k]
      if (v !== undefined && v !== null && (typeof v !== 'number' || v < 0 || v > 23)) {
        throw Errors.validation({ field: k, expected: '0-23 or null' })
      }
    }

    const sb = createUntypedServiceClient()

    // M6 fix — TRUE partial update. Previously we spread DEFAULTS over body,
    // clobbering existing user values for fields they didn't include.
    // First UPDATE; if no row affected, INSERT with defaults + body.
    const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }
    const upd = await sb
      .from('notification_preferences')
      .update(updates)
      .eq('user_id', claims.sub)
      .select('*')
      .maybeSingle()

    if (upd.error) throw Errors.internal(upd.error.message)

    if (upd.data) return jsonResponse(upd.data, { requestId })

    // No existing row — insert defaults merged with body
    const ins = await sb
      .from('notification_preferences')
      .insert({ user_id: claims.sub, ...DEFAULTS, ...body })
      .select('*')
      .single()
    if (ins.error) throw Errors.internal(ins.error.message)

    return jsonResponse(ins.data, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
