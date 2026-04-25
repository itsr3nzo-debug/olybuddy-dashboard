# Staging environment setup runbook

**Owner:** Renzo. **Status:** plan only — execution scheduled separately.

Today every change goes straight to production: localhost dev → push → Vercel build → live customers. That's worked while we have <10 paying clients but is increasingly fragile. This doc is the runbook for spinning up a real staging environment so we can:

- Test Stripe flows without touching live invoices
- Run database migrations against a non-customer copy first
- Test webhook signature changes without breaking real webhooks in flight
- Run e2e + manual QA before promotion

Goal: a fully-isolated staging that mirrors production architecture but can never charge a real card or write to a real customer's data.

---

## What "isolated" means

| Layer | Production | Staging |
|---|---|---|
| Domain | `nexley.vercel.app` | `staging-nexley.vercel.app` |
| Vercel project | `nexley-dashboard` | `nexley-dashboard-staging` |
| Git branch | `main` | `staging` (preview deploys per-PR also OK) |
| Supabase project | `awmsstlhbxsxlwydczdr.supabase.co` (live) | NEW — create separate project at signup time |
| Stripe | LIVE mode (`rk_live_*`) | TEST mode (`rk_test_*`) — separate keys |
| Telegram bot | live ops channel | dedicated staging channel |
| VPS fleet | Hetzner CPX22 production servers | One shared CPX21 used for staging client agents |
| SMTP | hello@nexley.ai (Gmail Workspace) | staging@nexley.ai or a Mailtrap/Ethereal capture (catches outbound, never delivers) |

---

## Step-by-step setup

### 1. Supabase project

1. Create a new Supabase project: `nexley-staging` in the **same region** as live (London — eu-west).
2. Apply every migration from production. The fastest path:
   ```bash
   # On a machine with both project URLs
   supabase db dump --db-url "postgres://...live..." --schema public,auth > prod-schema.sql
   supabase db push --db-url "postgres://...staging..." < prod-schema.sql
   ```
   Or use the Supabase CLI's branching feature: `supabase branches create staging`.
3. Copy the seed data we need for testing — preserve `pipeline_stages` and `sequences` definitions, but DON'T copy live `clients` / `agent_config` rows. Generate test fixtures instead.
4. Generate fresh anon + service role keys.

### 2. Stripe TEST mode

1. In the Stripe dashboard, toggle to **Test mode** (top-right).
2. Re-create the two prices:
   - `STRIPE_PRICE_TRIAL` — £20 one-time
   - `STRIPE_PRICE_EMPLOYEE` — £599/mo recurring
3. Generate a restricted **test** key (`rk_test_*`) with the same scopes as production.
4. Set up a webhook endpoint for `https://staging-nexley.vercel.app/api/webhook/stripe` with the same event subscriptions as live. Copy its `whsec_*`.
5. Create a separate Stripe Customer Portal config in test mode and capture its `bpc_*` ID.

### 3. Vercel project

1. Vercel dashboard → New Project → import the same repo, set build branch to `staging`.
2. Set ALL env vars to staging values:
   - `NEXT_PUBLIC_SUPABASE_URL` → staging
   - `SUPABASE_SERVICE_ROLE_KEY` → staging
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → staging
   - `STRIPE_SECRET_KEY` → `rk_test_*`
   - `STRIPE_WEBHOOK_SECRET` → staging webhook secret
   - `STRIPE_PRICE_TRIAL` / `STRIPE_PRICE_EMPLOYEE` → test-mode price IDs
   - `STRIPE_CUSTOMER_PORTAL_ID` → staging portal ID
   - `NEXT_PUBLIC_SITE_URL` → `https://staging-nexley.vercel.app`
   - `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` → staging bot + channel (create via @BotFather)
   - `CRON_SECRET` → fresh random hex
3. Confirm vercel.json's `alias` is **only** for production. Staging uses Vercel's default deployment URL.
4. Add a banner to `app/layout.tsx`: if `process.env.NEXT_PUBLIC_SITE_URL` includes `staging`, render a yellow strip across the top "STAGING — TEST DATA ONLY".

### 4. Telegram

1. Create a new bot via @BotFather: `/newbot` → `nexley-staging-bot`.
2. Add it to a fresh group called `Nexley Staging Ops`. Get the chat_id.
3. Set the staging Vercel env to that token + chat ID.

### 5. SMTP

Pick one:
- **Mailtrap** (recommended) — free tier captures every send, lets you preview HTML, never delivers. Set `SMTP_HOST/USER/PASS` to Mailtrap's sandbox creds.
- **Ethereal** — auto-generates throwaway accounts, similar story.
- **Real Gmail alias** (`staging@nexley.ai`) — only if we trust ourselves not to send to a real customer's inbox during tests.

### 6. Git workflow

```bash
# Default branching
main      → production (auto-deploy via Vercel)
staging   → staging (auto-deploy via staging Vercel project)

# For new features
git checkout -b feature/...
# Develop, push, PR -> staging, test, then PR -> main
```

The `.github/workflows/ci.yml` already runs on every push, so it'll catch type/lint/test regressions before Vercel even tries to build.

### 7. Test the round-trip

After setup, run through the canonical flow on staging:
1. Sign up at `https://staging-nexley.vercel.app/signup`
2. Use a Stripe test card `4242 4242 4242 4242` for the £20 onboarding fee
3. Verify webhook events land in staging Supabase + staging Telegram
4. Hit the Customer Portal, cancel, observe winback enrolment fires
5. Test referral code attribution
6. Test email verification flow
7. Test `/admin/slo` shows expected staging metrics

---

## Caveats

- VPS provisioning in staging is **manual** for now — we don't want to burn Hetzner quota on disposable staging clients. The provisioning_queue worker on Mac Mini reads from prod by default; for staging tests, manually mark clients `vps_status='active'` to simulate paid customer state.
- Do **not** copy real customer data across. If you need realistic-looking test data, use a faker script.
- Composio MCP integrations cost money per integration — use stub OAuth flows in staging where possible.
- Don't share staging URLs with anyone outside the dev team. The yellow STAGING banner is the only safety net.

---

## When to use staging vs prod

**Always go via staging for:**
- Database migrations
- Stripe webhook changes
- Anything touching the Customer Portal
- Auth flow changes (login/signup/verification)
- Cron new or modified endpoints

**Production direct is OK for:**
- Copy-only changes (button text, error messages)
- New marketing pages with no backend
- README/docs

When in doubt: staging first.
