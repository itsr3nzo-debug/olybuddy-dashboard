/**
 * GET /api/cron/sync-jwt-denylist
 *
 * Sweeps `jwt_denylist` for rows that haven't been pushed to Redis yet
 * (synced_to_redis_at IS NULL) and pushes them. The webhook handler does
 * this inline on the happy path; this cron is the safety net for cases
 * where Redis was briefly unreachable when the webhook fired.
 *
 * Schedule: every 2 minutes (vercel.json)
 */

import { revokeJti } from '@/lib/auth/revocation'
import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 60


let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  const sb = service()
  const startedAt = Date.now()

  const { data: pending, error } = await sb
    .from('jwt_denylist')
    .select('jti, user_id, reason, expires_at')
    .is('synced_to_redis_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(500)
  if (error) {
    console.error('[cron/sync-jwt-denylist] read failed:', error)
    return new Response('Read failed', { status: 500 })
  }

  let synced = 0
  let failed = 0
  for (const row of pending ?? []) {
    const ttlSec = Math.max(
      60,
      Math.floor((new Date(row.expires_at as string).getTime() - Date.now()) / 1000)
    )
    try {
      await revokeJti(row.jti as string, ttlSec, (row.reason as string) ?? 'signout')
      await sb
        .from('jwt_denylist')
        .update({ synced_to_redis_at: new Date().toISOString() })
        .eq('jti', row.jti)
      synced += 1
    } catch (err) {
      console.error('[cron/sync-jwt-denylist] sync failed for', row.jti, err)
      failed += 1
    }
  }

  // Also call the SQL purge function so we don't accumulate expired rows
  try {
    await sb.rpc('purge_expired_jwt_denylist')
  } catch (err) {
    console.error('[cron/sync-jwt-denylist] purge failed:', err)
  }

  return Response.json({
    ok: true,
    synced,
    failed,
    duration_ms: Date.now() - startedAt,
  })
}
