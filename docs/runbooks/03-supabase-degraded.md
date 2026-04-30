# 03 — Supabase degraded or down

Supabase backs auth, RLS, every query, Realtime, and Storage. When it's down,
nearly everything falls over. When it's degraded (slow), nothing fails clean
— it just gets sluggish.

## Symptoms

- `/api/mobile/health` returns `down` or `degraded`
- Sign-ins fail (`auth.invalid_token`) or hang past 5s
- Mobile dashboard never loads (`/api/mobile/me` 5xx)
- Vercel function durations p99 >2s for read endpoints
- Postgres connection errors in Vercel logs

## Quick diagnose

1. **Status page** — `https://status.supabase.com`. Check the region your
   project is in (typically `eu-west-2` for our project).
2. **What's degraded?**
   - Auth issues only → JWKS endpoint slow (`/auth/v1/.well-known/jwks.json`)
   - DB queries slow → connection pool exhausted, see #B below
   - Storage issues → independent of DB; check `vault` reads/writes
3. **Recent deploy?** A migration might be running long. `select query, now() - query_start as runtime from pg_stat_activity where state='active' order by runtime desc limit 5;` from Supabase SQL editor.

## Mitigation

### A. Full Supabase outage

1. Trip the master flag:
   ```sql
   -- Run in Supabase Edge SQL if available, or wait until back up
   update public.feature_flags
      set default_value = false, updated_at = now()
    where flag_key = 'mobile_app_enabled';
   ```
2. Mobile app sees `chat.upstream_error retryable=false`. It should show a
   maintenance banner pointing at `https://nexley.ai/status`.
3. Update status page. Subscribe to Supabase status updates.

### B. Connection pool exhausted

Symptom: `connection slots are reserved` errors in Vercel logs. Fix:
1. Verify `?pgbouncer=true&pool_mode=transaction` on the Supabase URL Vercel
   uses. Connections in transaction mode reuse far more efficiently.
2. Check if a long-running cron is holding connections — `pg_stat_activity`
   shows you what's hung.
3. Worst case: bounce Supabase via dashboard → Settings → Database → Restart.
   ~30s downtime, clears connections.

### C. RLS performance regression

Symptom: queries that worked yesterday are >5s. Likely a missing index after
a migration. `EXPLAIN ANALYZE` the offending query, add the index, push.

## Recovery

1. Supabase healthy → re-enable master flag
2. Synthetic test: `curl $DASHBOARD_URL/api/mobile/health` returns `status: ok`
3. Real test: cold-start mobile app, sign in, send a chat message
4. Watch Axiom for spike in successful requests — confirm flow

## Postmortem

- If RLS regression: write the missing-index migration into supabase-migration-*.sql
  and add the failing query to the test suite
- If pool exhaustion was caused by us (cron leak): fix the cron + add a
  pool-watcher cron that alerts when active connections >70% of cap

## Critical: backups

- Supabase auto-backs up daily; PITR is on for paid plans
- We've **never tested restore** as of 2026-04-28 — DA correctly flagged this
- TODO: quarterly drill that restores last night's backup into a staging
  project and verifies a couple of key tables (`agent_chat_messages`,
  `clients`)
