/**
 * POST /api/mobile/telemetry
 *
 * Batched event ingest from the mobile app. Mobile sends every 30s or
 * 50 events, whichever comes first.
 *
 * Body: { events: Array<{ event_name, properties?, occurred_at }>, app_version?, platform? }
 *
 * Accepts up to 200 events per request. Discards anything older than
 * 24h (mobile clock drift / queued offline forever).
 */

import { requireAuth } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


const MAX_EVENTS_PER_BATCH = 200
const MAX_AGE_MS = 24 * 60 * 60 * 1000

interface TelemetryEvent {
  event_name?: string
  properties?: Record<string, unknown>
  occurred_at?: string
}

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = (claims.app_metadata?.client_id as string | undefined) ?? null

    const body = (await request.json().catch(() => null)) as
      | { events?: TelemetryEvent[]; app_version?: string; platform?: string }
      | null
    if (!body || !Array.isArray(body.events)) {
      throw Errors.validation({ field: 'events' })
    }
    if (body.events.length === 0) return jsonResponse({ ok: true, accepted: 0 }, { requestId })
    if (body.events.length > MAX_EVENTS_PER_BATCH) {
      throw Errors.validation({ field: 'events', max: MAX_EVENTS_PER_BATCH })
    }

    const now = Date.now()
    const rows = body.events
      .filter((ev) => typeof ev.event_name === 'string' && ev.event_name.length > 0)
      .map((ev) => {
        const ts = ev.occurred_at ? Date.parse(ev.occurred_at) : NaN
        const occurredAt =
          !Number.isNaN(ts) && now - ts < MAX_AGE_MS && ts <= now
            ? new Date(ts).toISOString()
            : new Date().toISOString()
        return {
          user_id: claims.sub,
          client_id: clientId,
          app_version: body.app_version ?? null,
          platform: body.platform ?? null,
          event_name: (ev.event_name as string).slice(0, 80),
          properties: ev.properties ?? null,
          occurred_at: occurredAt,
        }
      })

    if (rows.length === 0) return jsonResponse({ ok: true, accepted: 0 }, { requestId })

    const sb = createUntypedServiceClient()
    const { error } = await sb.from('mobile_telemetry').insert(rows)
    if (error) {
      console.error('[telemetry] insert failed:', error)
      // Don't fail the request — telemetry is fire-and-forget
    }

    return jsonResponse({ ok: true, accepted: rows.length }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
