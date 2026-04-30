/**
 * Mobile JWT verification — JWKS-based, with Redis revocation denylist.
 *
 * Why both JWKS AND a denylist?
 *   JWKS verification is sub-ms (no DB round trip) but has a *revocation
 *   window* — once a JWT is signed, JWKS verifies it as valid until its
 *   `exp` regardless of whether the user signed out 30 seconds ago. To
 *   close that window, every request also checks Upstash Redis for the
 *   JWT's `jti` (or session ID); a Supabase auth webhook pushes
 *   sign-out / password-change events into the denylist with TTL = exp.
 *
 *   Denylist check is also sub-ms (Redis GET). So per-request we pay one
 *   JWKS verify + one Redis GET ≈ 2ms total. That's fine for hot-path.
 *
 * For *highly sensitive* operations (account delete, change phone, export
 * data) callers should additionally call `requireFreshAuth()` which does
 * a Supabase getUser() round-trip — verifying the session is still
 * server-side valid and not just unrevoked-in-cache.
 */

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose'
import { Errors } from '@/lib/api/errors'
import { isJtiRevoked } from '@/lib/auth/revocation'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

// Cached JWKS — jose handles refresh internally (~10 min default).
// We accept the small revocation window because the Redis denylist plugs it.
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  {
    cooldownDuration: 30_000,    // throttle re-fetches
    cacheMaxAge: 600_000,        // 10 min
  }
)

export interface SupabaseClaims extends JWTPayload {
  sub: string                                    // user_id
  email?: string
  app_metadata: {
    role?: 'super_admin' | 'owner' | 'member'
    client_id?: string
    provider?: string
  }
  user_metadata?: Record<string, unknown>
  aud: string                                    // 'authenticated'
  exp: number                                    // unix seconds
  iat: number
  iss: string
  jti?: string                                   // present on Supabase v2
  session_id?: string                            // present on newer Supabase
}

export async function verifyToken(token: string): Promise<SupabaseClaims> {
  let payload: JWTPayload
  try {
    const result = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    })
    payload = result.payload
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('exp')) throw Errors.expiredToken()
    throw Errors.invalidToken()
  }

  // Revocation check — denylist key is `jti` if present, else `session_id`,
  // else `sub:iat` as a stable compound. Whatever the auth webhook writes
  // must match this naming, see lib/auth/revocation.ts.
  const claims = payload as SupabaseClaims
  const denylistKey = claims.jti ?? claims.session_id ?? `${claims.sub}:${claims.iat}`
  if (await isJtiRevoked(denylistKey)) {
    throw Errors.signedOut()
  }

  return claims
}

/**
 * Extract bearer token from Authorization header, verify, return claims.
 * Throws ApiError on every failure path — callers wrap in errorResponse().
 */
export async function requireAuth(request: Request): Promise<SupabaseClaims> {
  const header = request.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw Errors.invalidToken()
  }
  const token = header.slice(7).trim()
  if (!token) throw Errors.invalidToken()
  return verifyToken(token)
}

/**
 * For SSE endpoints — EventSource can't send headers, so the JWT comes via
 * `?token=...` querystring. Same verification rules.
 */
export async function requireAuthFromQuery(request: Request): Promise<SupabaseClaims> {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) throw Errors.invalidToken()
  return verifyToken(token)
}

/**
 * Sensitive-op check — re-verify the session is still server-side valid
 * via supabase.auth.getUser(). Costs one Supabase round-trip (~80ms).
 * Use for: delete account, change email/phone, GDPR export.
 *
 * DA B13 fix — Supabase client lifted to module scope (lazy-init once)
 * so we don't allocate a fresh GoTrue client + connection per call.
 */
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

let _freshAuthClient: SupabaseClient | null = null
function getFreshAuthClient(): SupabaseClient {
  if (!_freshAuthClient) {
    _freshAuthClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  }
  return _freshAuthClient
}

export async function requireFreshAuth(request: Request): Promise<SupabaseClaims> {
  const claims = await requireAuth(request)
  const token = (request.headers.get('authorization') ?? '').slice(7).trim()
  const { data, error } = await getFreshAuthClient().auth.getUser(token)
  if (error || !data.user) throw Errors.signedOut()
  return claims
}

/** Convenience — does the user have super_admin role. */
export function isSuperAdmin(claims: SupabaseClaims): boolean {
  return claims.app_metadata?.role === 'super_admin'
}

/** Convenience — pull the (always-pinned) client_id for owner/member users. */
export function getClientIdFromClaims(claims: SupabaseClaims): string {
  const id = claims.app_metadata?.client_id
  if (!id) {
    // super_admin without a pinned client must use cross-tenant routes that
    // explicitly accept ?client= overrides; mobile callers are never that.
    throw Errors.forbidden('No client_id on session.')
  }
  return id
}
