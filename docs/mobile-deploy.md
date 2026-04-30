# Mobile backend deploy runbook

End-to-end steps to take the mobile API from local repo to verified-on-Vercel.
Aim: 60–90 minutes if no surprises. Run sequentially — don't skip ahead.

## 0. Pre-deploy checklist

- [ ] `bun install` complete (look for `@upstash/ratelimit`, `@upstash/redis`, `jose` in `node_modules`)
- [ ] `npx tsc --noEmit` is clean
- [ ] `supabase-migration-mobile-backend.sql` already applied to live Supabase
      (verified — done via `mcp__supabase__apply_migration` 2026-04-29)

## 1. External account setup

### 1.1 Upstash Redis

1. https://console.upstash.com → Create Database
2. Region: London (eu-west-1) for proximity to Supabase + Vercel London
3. Plan: Pay-as-you-go (free tier covers ~10k commands/day; we'll pay ~$5/mo)
4. Copy REST URL + REST Token

### 1.2 OneSignal

1. https://app.onesignal.com → New App
2. Name: "Nexley AI Mobile"
3. Platform: configure both iOS (APNs) and Android (FCM) —
   you can defer the platform-specific keys until the mobile app is built
4. **Declare notification categories now** — Settings → Push Settings →
   Add Category for each:
   - `escalation` (high priority, sound on)
   - `customer_reply` (default priority, sound on)
   - `estimate_action` (default priority, sound on)
   - `daily_digest` (low priority, no sound)
   - `system` (default, no sound)
   - `billing` (default, no sound)
5. **Declare Android channels** in your Android app manifest later — channel
   IDs already wired in `lib/push/onesignal.ts`:
   - `escalation_high`, `customer_reply_default`, `estimate_action_default`,
     `daily_digest_low`, `system_default`, `billing_default`
6. Copy App ID + REST API Key

### 1.3 Supabase Storage bucket for GDPR exports

```bash
# In Supabase dashboard SQL editor:
insert into storage.buckets (id, name, public)
  values ('gdpr-exports', 'gdpr-exports', false)
on conflict (id) do nothing;
```

### 1.4 Supabase Database Webhook for sign-out → JWT denylist

1. Supabase dashboard → Database → Webhooks → New Webhook
2. **Table**: `auth.sessions`
3. **Events**: `Delete`
4. **HTTP Method**: POST
5. **URL**: `https://nexley.vercel.app/api/webhooks/supabase-session-revoked`
6. **HTTP Headers**:
   - `Authorization`: `Bearer <SUPABASE_DB_WEBHOOK_SECRET>` (generate any
     32+ char random string — same value goes in Vercel env)

## 2. Vercel env vars

Set these in Vercel dashboard → Project → Settings → Environment Variables → Production:

```
UPSTASH_REDIS_REST_URL=https://<id>.upstash.io
UPSTASH_REDIS_REST_TOKEN=A...
ONESIGNAL_APP_ID=<uuid>
ONESIGNAL_REST_API_KEY=os_v2_app_...
SUPABASE_DB_WEBHOOK_SECRET=<32+ char random>
CRON_SECRET=<32+ char random>      # if not already set
```

(All other env vars — Supabase, Stripe, Anthropic, Composio — are already in
place from prior dashboard work.)

Verify with:
```bash
bash scripts/mobile-env-check.sh production
```

## 3. Deploy

```bash
git add -A
git commit -m "Mobile backend: routes, crons, migration, schema refactor"
git push origin main
# Vercel auto-deploys; or:
vercel --prod
```

Watch the deploy logs. Crons take effect ~5 min after deploy.

## 4. Smoke test

You'll need a Supabase access_token for an existing test user. Easiest way:
sign in via the dashboard browser, open DevTools → Application → Cookies →
copy `sb-<project>-auth-token` → JSON-decode and grab `access_token`.

Or programmatically:
```bash
curl "https://awmsstlhbxsxlwydczdr.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"<test-user>","password":"<pw>"}' | jq -r '.access_token'
```

Run the smoke suite:

```bash
BASE_URL=https://nexley.vercel.app \
JWT=eyJhbGciOi... \
bash scripts/mobile-smoke-test.sh
```

Expected: 0 failures. If anything fails, check the `X-Request-Id` header in
the response and trace through Vercel logs.

## 5. Post-deploy verification

| Check | How |
|---|---|
| `/api/mobile/health` returns `status: "ok"` | `curl https://nexley.vercel.app/api/mobile/health` |
| Cron `sync-jwt-denylist` running every 2m | Vercel dashboard → Functions → Crons tab — should show last invocation timestamp |
| Webhook fires on sign-out | Sign out a user; check `jwt_denylist` table for new row in <5s |
| OneSignal alias works | Run mobile app sign-in flow once; check OneSignal users tab for `external_id` aliased subscription |
| Idempotency works | Smoke test #7 + #8 should both pass |
| Rate limits trigger | Run `/api/mobile/inbox` 700 times in a minute — should start 429ing around request 600 |

## 6. Anthropic key — production sanity check

```bash
# Hit the actual Anthropic API once with our key:
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":50,"messages":[{"role":"user","content":"hi"}]}'
```

Expected: 200 OK with a content array containing a `text` block.

## 7. Status page (optional but recommended)

Subscribe `/api/mobile/health` to Better Stack / StatusGator / your status
provider. Set up alerting on `status: "down"` or any 5xx.

## 8. Phase 0 (deferred — separate project)

The Anthropic API migration of existing WhatsApp VPSes (Varley, Joseph,
nexley-admin) is a separate operational track. Code is in place
(`/api/agent/handle-message`) but the actual cutover hasn't been done yet —
existing VPSes are still on Claude Code subscription, which the April 4
2026 ToS change banned. See:
- `docs/runbooks/01-anthropic-outage.md` (covers fallback)
- The migration runbook section in the main backend plan

## Rollback

If something is badly broken:

1. Disable the master flag (Supabase SQL editor):
   ```sql
   update public.feature_flags set default_value = false where flag_key = 'mobile_app_enabled';
   ```
   This causes most write endpoints to refuse cleanly while reads still work.

2. Or revert the Vercel deploy (Vercel dashboard → Deployments → previous → "Promote to Production")

3. Migrations are idempotent and additive — no rollback DDL needed unless we
   actively delete columns later.

## Known limitations (v1)

- **Bedrock fallback is wired but disabled** (`llm_fallback_bedrock` flag = false)
  — provider exists as a stub in `lib/llm/provider.ts`, no real implementation yet
- **Voice in chat composer is wired but disabled** (`mobile_voice_enabled` flag = false)
- **Phase 0 fleet migration not executed** — VPSes still on Claude Code
- **No load tests run yet** — k6 against `/api/chat/stream` is recommended pre-launch
- **Mobile telemetry is fire-and-forget** — no consumer of `mobile_telemetry`
  table yet (planned: Axiom export)
