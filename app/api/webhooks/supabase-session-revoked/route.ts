/**
 * POST /api/webhooks/supabase-session-revoked
 *
 * Receives Supabase Database Webhook events for `auth.sessions DELETE`.
 * (Supabase has no native outbound auth webhook in 2026 — Database
 * Webhooks on auth.sessions are the canonical mechanism.)
 *
 * Setup steps in Supabase dashboard:
 *   Database → Webhooks → New Webhook
 *     Table: auth.sessions
 *     Events: DELETE
 *     URL: https://nexley.vercel.app/api/webhooks/supabase-session-revoked
 *     HTTP Method: POST
 *     Headers: Authorization: Bearer <SUPABASE_DB_WEBHOOK_SECRET>
 *
 * The handler:
 *   1. Verifies the bearer matches our shared secret (constant-time)
 *   2. Inserts a `jwt_denylist` row with the session id + reason
 *   3. Pushes to Upstash Redis inline (so the very next request 401s)
 *
 * Body shape (Supabase Database Webhooks):
 *   {
 *     type: 'DELETE',
 *     table: 'sessions',
 *     schema: 'auth',
 *     record: null,
 *     old_record: { id, user_id, created_at, updated_at, ... }
 *   }
 *
 * Idempotent: re-delivery of the same DELETE event upserts the same denylist
 * row and re-syncs Redis (cheap).
 */

import { revokeJti } from '@/lib/auth/revocation'
import { newRequestId, jsonResponse } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

const WEBHOOK_SECRET = process.env.SUPABASE_DB_WEBHOOK_SECRET!

let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface DbWebhookEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: Record<string, unknown> | null
  old_record: Record<string, unknown> | null
}

export async function POST(request: Request) {
  const requestId = newRequestId()

  // 1. Auth — bearer secret, constant-time compare
  const auth = request.headers.get('authorization') ?? ''
  const presented = auth.replace(/^Bearer\s+/i, '').trim()
  if (!WEBHOOK_SECRET || !timingSafeEqual(presented, WEBHOOK_SECRET)) {
    console.warn('[supabase-session-revoked] auth fail', { requestId })
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Parse + filter
  let event: DbWebhookEvent
  try {
    event = (await request.json()) as DbWebhookEvent
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }
  if (event.type !== 'DELETE' || event.table !== 'sessions' || event.schema !== 'auth') {
    return jsonResponse({ ok: true, ignored: true }, { requestId })
  }

  const old = event.old_record
  if (!old) return jsonResponse({ ok: true, no_old_record: true }, { requestId })

  const sessionId = String(old.id ?? '')
  const userId = String(old.user_id ?? '')
  if (!sessionId) {
    return new Response('Missing session id', { status: 400 })
  }

  // Best-effort: if old record carries `not_after` / `expires_at`, use it; else
  // ceiling at 24h (JWTs don't live longer than that in our config)
  const rawExp = (old.not_after as string | null) ?? (old.expires_at as string | null) ?? null
  const expiresAtIso = rawExp ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const sb = service()

  // 3. Insert denylist row (idempotent via PK upsert)
  const { error: dbErr } = await sb.from('jwt_denylist').upsert(
    {
      jti: sessionId,
      user_id: userId || null,
      reason: 'signout',
      expires_at: expiresAtIso,
      synced_to_redis_at: null,
    },
    { onConflict: 'jti' }
  )
  if (dbErr) {
    console.error('[supabase-session-revoked] db upsert failed:', dbErr)
    // Return 200 anyway — Vercel won't retry but the cron sweep will catch it
  }

  // 4. Push to Redis inline so the next request observes revocation immediately
  try {
    const ttlSec = Math.max(60, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000))
    await revokeJti(sessionId, ttlSec, 'signout')
    await sb.from('jwt_denylist').update({ synced_to_redis_at: new Date().toISOString() }).eq('jti', sessionId)
  } catch (err) {
    console.error('[supabase-session-revoked] redis push failed (cron will retry):', err)
  }

  return jsonResponse({ ok: true, session_id: sessionId }, { requestId })
}
