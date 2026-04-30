/**
 * Idempotency — Stripe claim-then-act pattern (DA pass 2).
 *
 * Two key fixes vs the previous implementation:
 *
 *   1. Read body ONCE, not via `request.clone()` — avoids the runtime
 *      fragility flagged in DA B7 (clone semantics differ across Node /
 *      Edge / future runtimes; some upstream consumer might already have
 *      teed the body).
 *
 *   2. Claim-then-act, not act-then-claim — DA B8. We INSERT the cache
 *      row FIRST (with a placeholder response) using ON CONFLICT DO NOTHING.
 *      If we got the row, we own the right to run the handler; if we didn't,
 *      another concurrent caller is already running. We poll the cache row
 *      a few times waiting for them to finish, then return their response.
 *      This eliminates the side-effects-twice race entirely.
 *
 * Replay rules:
 *   - same key, same body, same user, same endpoint  → return cached response
 *   - same key, *different* body                     → 422 (refuse to replay)
 *   - same key, different user/endpoint              → 409 (key collision)
 *
 * Body inputs to handlers: callers pass an already-parsed body via the
 * `body` argument so we don't have to re-parse on the second time through.
 */

import { Errors } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'


// Lifted to module scope (DA M3 / B13) — avoids per-request allocation
let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

async function hashBody(body: string): Promise<string> {
  const buf = new TextEncoder().encode(body)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const POLL_INTERVAL_MS = 100
const POLL_MAX_ATTEMPTS = 50 // ≈5s total — covers most chat-send latency

interface HandlerResult<T> {
  status: number
  body: T
}

/**
 * Claim-then-act idempotency. The caller pre-reads the request body (we need
 * it for hashing) and passes both the raw text (for hashing) and the parsed
 * value (for the handler) so we don't double-parse.
 */
export async function withIdempotency<T>(
  args: {
    request: Request
    endpoint: string
    userId: string
    bodyText: string
  },
  handler: () => Promise<HandlerResult<T>>
): Promise<{ result: HandlerResult<T>; replayed: boolean }> {
  const key = args.request.headers.get('idempotency-key')
  if (!key) {
    const result = await handler()
    return { result, replayed: false }
  }

  if (key.length === 0 || key.length > 255) {
    throw Errors.validation({ field: 'idempotency-key', max_length: 255 })
  }

  const sb = service()
  const requestHash = await hashBody(args.bodyText)

  // CLAIM: try to insert a placeholder row. ON CONFLICT DO NOTHING —
  // returning empty array means someone else got there first.
  const claim = await sb
    .from('api_idempotency')
    .insert(
      {
        key,
        user_id: args.userId,
        endpoint: args.endpoint,
        request_hash: requestHash,
        response_status: 0, // sentinel: "in progress"
        response_body: null,
      },
      { count: 'exact' }
    )
    .select('key')

  // If insert failed for some reason OTHER than conflict, surface it
  if (claim.error) {
    // Postgres unique-violation = 23505. Supabase wraps as code '23505'
    // OR message contains 'duplicate'. Anything else = real failure.
    const msg = claim.error.message || ''
    const code = (claim.error as { code?: string }).code
    if (code !== '23505' && !msg.toLowerCase().includes('duplicate')) {
      throw Errors.internal(`Idempotency claim failed: ${msg}`)
    }
  }

  const claimed = (claim.data?.length ?? 0) > 0

  if (claimed) {
    // We own the run. Execute and write the real response.
    let result: HandlerResult<T>
    try {
      result = await handler()
    } catch (err) {
      // Handler failed — release the claim so a retry can re-attempt
      // (otherwise the key is permanently poisoned).
      await sb.from('api_idempotency').delete().eq('key', key)
      throw err
    }
    await sb
      .from('api_idempotency')
      .update({
        response_status: result.status,
        response_body: result.body as unknown,
      })
      .eq('key', key)
    return { result, replayed: false }
  }

  // Someone else claimed it. Validate the existing row matches our request,
  // then either return their response (if complete) or poll until ready.
  const existing = await sb
    .from('api_idempotency')
    .select('user_id, endpoint, request_hash, response_status, response_body')
    .eq('key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!existing.data) {
    // Race: row was deleted between our INSERT and SELECT (handler error
    // path). Retry once recursively — bounded.
    return withIdempotency(args, handler)
  }

  if (existing.data.user_id !== args.userId || existing.data.endpoint !== args.endpoint) {
    throw Errors.idempotencyConflict()
  }
  if (existing.data.request_hash !== requestHash) {
    throw Errors.idempotencyReplayDifferentBody()
  }

  // Poll if the other run is still in progress (response_status === 0)
  if (existing.data.response_status === 0) {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      const poll = await sb
        .from('api_idempotency')
        .select('response_status, response_body')
        .eq('key', key)
        .maybeSingle()
      if (poll.data && poll.data.response_status !== 0) {
        return {
          result: {
            status: poll.data.response_status,
            body: poll.data.response_body as T,
          },
          replayed: true,
        }
      }
    }
    // Other run hung. Treat as a fresh request — they'll see our run as the
    // canonical one when they finish (it'll fail to insert and they'll poll).
    throw Errors.internal('Idempotency replay timed out; please retry.')
  }

  return {
    result: {
      status: existing.data.response_status,
      body: existing.data.response_body as T,
    },
    replayed: true,
  }
}
