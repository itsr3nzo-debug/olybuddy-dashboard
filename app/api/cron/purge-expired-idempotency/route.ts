/**
 * GET /api/cron/purge-expired-idempotency
 *
 * Purges expired rows from `api_idempotency` (24h TTL). Daily.
 * Also purges old `mobile_telemetry` (90d retention) in the same pass —
 * piggy-backed because both are house-keeping and the SQL is small.
 *
 * Schedule: 03:00 UTC daily (vercel.json)
 */

import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 60


export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  const sb = createUntypedServiceClient()

  const [idem, telem, sse] = await Promise.all([
    sb.rpc('purge_expired_idempotency'),
    sb.rpc('purge_old_mobile_telemetry'),
    sb.rpc('purge_expired_sse_tickets'),
  ])

  return Response.json({
    ok: true,
    sse_purged: sse.error ? 0 : (sse.data as number),
    idempotency_purged: idem.error ? 0 : (idem.data as number),
    telemetry_purged: telem.error ? 0 : (telem.data as number),
    errors: [idem.error, telem.error].filter(Boolean).map((e) => e?.message),
  })
}
