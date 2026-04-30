/**
 * JWT revocation denylist — backed by Upstash Redis.
 *
 * Flow:
 *   1. Supabase auth webhook fires on sign-out / password-change / token-revoke
 *   2. Webhook handler (api/webhooks/supabase-auth) writes to public.jwt_denylist
 *   3. A sync worker (api/cron/sync-jwt-denylist) replicates pending rows into
 *      Upstash Redis with TTL = (jwt_exp - now()), then marks synced_at
 *   4. Every authenticated request calls isJtiRevoked() — sub-ms Redis GET
 *
 * This closes the JWKS revocation window (5–10 min default) without paying
 * a Supabase round-trip on every request.
 *
 * If Redis is unavailable, isJtiRevoked() *fails open* (returns `false`,
 * lets the request through) — see the in-body comment in isJtiRevoked()
 * for the reasoning. The high-sensitivity routes use requireFreshAuth()
 * which does a live Supabase getUser() check and is unaffected by Redis
 * state, so the two layers compose correctly:
 *   • Hot-path: JWKS verify + Redis denylist (fast, fail-open on outage)
 *   • Sensitive ops: + live getUser() (fail-closed on Supabase issue)
 */

import { Redis } from '@upstash/redis'

const PREFIX = 'jwt_revoked:'
const TTL_FAILSAFE_SEC = 60 * 60 * 24 // 24h ceiling — Supabase JWTs default 1h, this is just a guard

let _redis: Redis | null = null

function getRedis(): Redis {
  if (_redis) return _redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured')
  }
  _redis = new Redis({ url, token })
  return _redis
}

/**
 * @returns true if the JWT identified by `key` has been revoked.
 *          false if it's still valid (or denylist unreachable + we choose to
 *          return false — see comment below).
 */
export async function isJtiRevoked(key: string): Promise<boolean> {
  try {
    const result = await getRedis().get<string>(`${PREFIX}${key}`)
    return result !== null
  } catch (err) {
    // Decision: in Redis outage, return *false* (let request through) rather
    // than fail closed. Reasoning: the fallback is JWKS-only verification
    // (the prior security baseline), which is what the rest of the industry
    // ships. Failing closed would lock every user out for the duration of an
    // Upstash incident — that's worse than the residual ~10min revocation
    // window we'd otherwise have.
    //
    // For *highly sensitive* operations call requireFreshAuth() which does
    // a live supabase.auth.getUser() check and is unaffected by Redis state.
    console.error('[revocation] Redis check failed, returning unrevoked:', err)
    return false
  }
}

/**
 * Mark a JWT as revoked. Call from the Supabase auth webhook handler.
 * `key` should match the one used in lib/auth/claims.ts (jti ?? session_id ?? sub:iat).
 */
export async function revokeJti(
  key: string,
  expiresInSec: number,
  reason: string
): Promise<void> {
  const ttl = Math.min(Math.max(expiresInSec, 60), TTL_FAILSAFE_SEC)
  await getRedis().setex(`${PREFIX}${key}`, ttl, reason)
}
