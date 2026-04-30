/**
 * Tiered rate limits — Upstash Redis sliding window.
 *
 * DA flagged that flat 120/min would trip on legitimate use (pull-to-refresh
 * + infinite scroll Inbox doubles every page-fetch). Splitting into three
 * tiers gives chat its own budget while reads run at 10× the ceiling.
 *
 *   chat_send  — 20 / minute  (20 messages = ~1 actively-typing user)
 *   reads      — 600 / minute (10 / second sustained, plenty for inbox scroll)
 *   mutations  — 60 / minute  (write actions: take-over, mark-read, settings)
 *   signin     — 5 / 15min per IP (brute-force guard)
 *   push_enr   — 10 / hour per user (re-installs)
 *
 * If Upstash is down the limiter "fails open" — same reasoning as the
 * revocation denylist. Logged loudly so the on-call can spot it.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { Errors } from '@/lib/api/errors'

let _redis: Redis | null = null
function redis(): Redis {
  if (_redis) return _redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('UPSTASH_REDIS_* not configured')
  _redis = new Redis({ url, token })
  return _redis
}

// Lazy-init so importing the module doesn't blow up in tests/local without env
let limiters: ReturnType<typeof buildLimiters> | null = null
function buildLimiters() {
  const r = redis()
  return {
    chat_send: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(20, '1 m'),
      analytics: true,
      prefix: 'rl:chat_send',
    }),
    reads: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(600, '1 m'),
      analytics: true,
      prefix: 'rl:reads',
    }),
    mutations: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      analytics: true,
      prefix: 'rl:mutations',
    }),
    signin: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      analytics: true,
      prefix: 'rl:signin',
    }),
    push_enroll: new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      analytics: true,
      prefix: 'rl:push_enroll',
    }),
  }
}

export type LimitTier = 'chat_send' | 'reads' | 'mutations' | 'signin' | 'push_enroll'

/**
 * Throws ApiError(rate_limit.exceeded) if blocked. Returns silently on success.
 * `key` is typically user_id; for `signin` it must be IP; for unauth routes
 * fall back to IP from x-forwarded-for.
 */
export async function enforceLimit(tier: LimitTier, key: string): Promise<void> {
  if (!limiters) {
    try {
      limiters = buildLimiters()
    } catch (err) {
      console.error('[ratelimit] failed to init, failing open:', err)
      return
    }
  }
  let result: Awaited<ReturnType<Ratelimit['limit']>>
  try {
    result = await limiters[tier].limit(key)
  } catch (err) {
    console.error(`[ratelimit] check failed (${tier}, ${key}), failing open:`, err)
    return
  }
  if (!result.success) {
    const retryAfterMs = Math.max(result.reset - Date.now(), 1000)
    throw Errors.rateLimited(retryAfterMs)
  }
}

/** Pull a stable IP for unauth/signin routes. */
export function ipFromRequest(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}
