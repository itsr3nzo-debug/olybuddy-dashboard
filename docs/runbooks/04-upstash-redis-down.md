# 04 — Upstash Redis down

Redis backs:
1. Rate limit counters (`@upstash/ratelimit`)
2. JWT revocation denylist (`lib/auth/revocation.ts`)

Both fail OPEN by design — see comments in those files. So a Redis outage
is **not user-facing** but does open up two security/abuse windows:

- Rate limits don't fire → an abusive client could flood
- JWT revocation lookups return false → ~10 min revocation window opens
  (the JWKS cache window) until JWT exp naturally fires

## Symptoms

- `/api/mobile/health` returns `degraded` (`redis: fail`)
- Vercel logs flood with `[ratelimit] check failed, failing open`
- Vercel logs flood with `[revocation] Redis check failed, returning unrevoked`

## Quick diagnose

1. **Status page** — `https://status.upstash.com`
2. **Is it just slow or fully down?** `redis.ping()` from a Vercel function:
   ```bash
   curl "$UPSTASH_REDIS_REST_URL/ping" -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN"
   ```
3. **Wrong env vars?** Recent rotation? Check `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` in Vercel.

## Mitigation

### A. Genuine Upstash outage

System fails open for 2 things; nothing user-facing breaks. **DO NOT** flip
flags here — the open windows are bounded and acceptable for short outages.

What you may want to do:
1. Watch for abuse on Vercel logs — search for any user_id appearing >100x in
   5 min. If you see one, manually `signOut(user_id)` via Supabase admin.
2. For sensitive ops (data-export, account-delete), the `requireFreshAuth()`
   path does a live Supabase getUser() call — those stay safe.

### B. Quota exhausted (rare on Upstash but possible if abuse drives spend)

Upstash bills per command. If quota hits hard cap, requests start 429ing.
Increase quota in Upstash dashboard → Plan.

### C. Wrong env vars

Trivial: copy fresh from Upstash dashboard → Vercel env → redeploy. Cache
warms on first request after deploy.

## Recovery

1. Upstash healthy → log noise stops on its own (lazy init re-runs)
2. Synthetic test: hit `/api/mobile/health`, see `redis: ok`
3. If revocation denylist had pending unsynced rows during the outage, run:
   ```bash
   curl -X POST "$DASHBOARD_URL/api/cron/sync-jwt-denylist" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   This drains `public.jwt_denylist` rows where `synced_to_redis_at IS NULL`.

## Postmortem

If outage caused observed abuse (rare but possible):
- Identify users who abused — Vercel logs aggregated by user_id
- Decide if action needed (usually warning email; rarely ban)
- Consider whether the revocation window was material — if yes, accelerate
  the project to short-TTL access tokens (currently 1h; could be 15m)
