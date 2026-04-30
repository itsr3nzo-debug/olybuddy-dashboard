/**
 * GET /api/mobile/health
 *
 * Public endpoint — no auth. Used by:
 *   - mobile app on cold start to detect outages and show a status banner
 *   - Better Stack / status page heartbeat probe
 *   - Vercel preview environment smoke test
 *
 * Checks:
 *   - Supabase reachable
 *   - Anthropic reachable (HEAD on api.anthropic.com)
 *   - Upstash Redis reachable
 *
 * Response:
 *   { status: 'ok' | 'degraded' | 'down',
 *     checks: { supabase, anthropic, redis },
 *     server_time: ISO,
 *     version: string }
 *
 * 'degraded' = some checks failed but core path still works
 * 'down' = Supabase down (everything else needs it)
 */

import { createClient } from '@supabase/supabase-js'
import { jsonResponse, newRequestId } from '@/lib/api/errors'

export const runtime = 'nodejs'

const CHECK_TIMEOUT_MS = 2_500

async function checkWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      fn().then((r) => ({ ok: true as const, result: r })),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs)
      }),
    ])
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function GET() {
  const requestId = newRequestId()
  const startedAt = Date.now()

  const [supabase, anthropic, redis] = await Promise.all([
    checkWithTimeout(async () => {
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { error } = await sb.from('feature_flags').select('flag_key').limit(1)
      if (error) throw error
      return true
    }),
    checkWithTimeout(async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'HEAD' })
      // 401/403 are fine — the host is up, just rejecting our HEAD
      return r.status < 500
    }),
    checkWithTimeout(async () => {
      const url = process.env.UPSTASH_REDIS_REST_URL
      const token = process.env.UPSTASH_REDIS_REST_TOKEN
      if (!url || !token) return false
      const r = await fetch(`${url}/ping`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return r.ok
    }),
  ])

  const checks = {
    supabase: supabase.ok ? 'ok' : 'fail',
    anthropic: anthropic.ok && anthropic.result ? 'ok' : 'fail',
    redis: redis.ok && redis.result ? 'ok' : 'fail',
  }

  const status = !supabase.ok
    ? 'down'
    : !(anthropic.ok && anthropic.result) || !(redis.ok && redis.result)
      ? 'degraded'
      : 'ok'

  return jsonResponse(
    {
      status,
      checks,
      server_time: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
      duration_ms: Date.now() - startedAt,
    },
    {
      status: status === 'down' ? 503 : 200,
      requestId,
    }
  )
}
