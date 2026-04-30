# Deploy checklist — Nexley dashboard + mobile

End-to-end deploy steps. Tick each before considering shipping.

## 1. Pre-flight

- [x] Migrations applied to live Supabase (`build_progress`, `build_chunks`,
      `build_tokens`, `sse_tickets`, `captures`, `gdpr_requests`,
      `notifications`, `notification_preferences`, `push_subscriptions`,
      `mobile_telemetry`, `feature_flags`, `feature_flag_overrides`,
      `llm_budget_periods`, `jwt_denylist`, `api_idempotency`,
      `agent_actions.category` extended, `conversation_sessions` columns
      added, `estimates.dedupe_key`/`created_by_ai` added)
- [x] Storage buckets created (`build-screenshots`, `captures`,
      `gdpr-exports`)
- [x] `next build` clean (TypeScript + lint pass)
- [x] Initial build token seeded in `build_tokens` table

## 2. Vercel env vars (set on Production)

Required for full functionality:

```
# Already set (existing dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://awmsstlhbxsxlwydczdr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
COMPOSIO_API_KEY=...
CRON_SECRET=...
NEXT_PUBLIC_SITE_URL=https://nexley.vercel.app

# NEW for mobile backend
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...
ONESIGNAL_APP_ID=<uuid>           # iOS push (mobile app)
ONESIGNAL_REST_API_KEY=os_v2_...

# NEW for auth + sessions
SUPABASE_DB_WEBHOOK_SECRET=<32+ char random>

# NEW for build visibility
BUILD_PUBLIC_TOKEN=nES81g_31QGVxSTQ8JYXursn2bjL1ppC  # initial; auto-rotates weekly
BUILD_DIGEST_EMAIL=lorenzo@yourdomain          # daily 6pm London digest goes here

# Optional — auto-screenshot on deploy
VERCEL_WEBHOOK_SECRET=<32+ char random>

# SMTP for digest emails (use any of: Gmail OAuth, generic SMTP, Resend)
SMTP_HOST=smtp.gmail.com
SMTP_USER=ops@nexley.ai
SMTP_PASS=<app-password>
SMTP_FROM=ops@nexley.ai
SMTP_PORT=465                      # 465 for TLS, 587 for STARTTLS
```

## 3. Supabase one-time setup

- [ ] **Database Webhook** for sign-out detection (DA fix B12)
  - Database → Webhooks → New Webhook
  - Table: `auth.sessions`, Events: `Delete`
  - URL: `https://nexley.vercel.app/api/webhooks/supabase-session-revoked`
  - Headers: `Authorization: Bearer <SUPABASE_DB_WEBHOOK_SECRET>`

## 4. OneSignal

- [ ] Create OneSignal app (org: Nexley, app name: "Nexley AI Mobile")
- [ ] Add iOS platform + upload APNs key (from Apple Developer)
- [ ] Add Android platform + paste Firebase Server Key
- [ ] Declare notification categories in OneSignal dashboard:
  - `escalation` — high priority, sound on, iOS time-sensitive
  - `customer_reply` — default priority
  - `estimate_action` — default priority
  - `daily_digest` — low priority, no sound
  - `system` — default
  - `billing` — default
- [ ] Copy App ID + REST API Key to Vercel env

## 5. Vercel deploy hook (optional — auto-screenshots)

- [ ] Vercel dashboard → Settings → Webhooks → Create
- [ ] Events: `deployment.succeeded`
- [ ] URL: `https://nexley.vercel.app/api/internal/vercel-deploy-hook`
- [ ] Secret: same value as `VERCEL_WEBHOOK_SECRET` env var

## 6. Push to deploy

```bash
cd /Users/claudia/Desktop/nexley-dashboard
git add -A
git commit -m "Mobile build: end-to-end audit fixes — disconnect, OAuth deep link, polling page, schema alignment"
git push origin main
# OR: vercel --prod
```

## 7. Smoke test after deploy

```bash
# Health
curl https://nexley.vercel.app/api/mobile/health

# Build status page (should render mobile-friendly)
open "https://nexley.vercel.app/build/mobile?key=nES81g_31QGVxSTQ8JYXursn2bjL1ppC"

# Prototype (should boot, show mock data)
open "https://nexley.vercel.app/preview/mobile"
```

Then in the prototype:
1. Tap Settings tab
2. Paste a Supabase access token (sign in via the dashboard, copy from cookie)
3. Tap Save → top-right shows "LIVE" green pip
4. Go Home → real data populates
5. Tap camera FAB → snap a receipt → watch AI Vision extract → tap "Log expense" → toast appears

## 8. Mobile RN app (separate project)

```bash
cd /Users/claudia/Desktop/nexley-mobile-rn
bun install                       # ~2-3 min, may show peer-deps warnings (fine)
cp .env.example .env.local        # fill in EXPO_PUBLIC_SUPABASE_*

# Run on iOS simulator (works WITHOUT a dev build for the basic flow)
bun run ios

# Real device dev build (required for OneSignal + document scanner native modules)
eas login
eas init                           # links project, sets eas.projectId in app.json
eas build --profile development --platform ios
# ~25 min, lands on TestFlight Internal
```

## 9. App Store + Play Store (see APP_STORE_CHECKLIST.md)

Long-tail. Read that doc before submitting.
