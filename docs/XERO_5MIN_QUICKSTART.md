# Xero → live for every client in 5 minutes

One-time setup. After this, every Nexley client can connect their own Xero with one click.

## Step 1 — Register the Nexley AI app on Xero (3 min)

1. Go to **https://developer.xero.com/app/manage**
2. Sign in (or create a free developer account — use `kadedillonai56@gmail.com` so it's tied to the main Nexley account)
3. Click **New app**
4. Fill in:

   | Field | Value |
   |---|---|
   | Integration type | **Web app** |
   | App name | `Nexley AI` |
   | Company or application URL | `https://nexley.vercel.app` |
   | Privacy policy URL | `https://nexley.vercel.app/privacy` |
   | OAuth 2.0 redirect URI | `https://nexley.vercel.app/api/oauth/xero/callback` |

5. Accept the Xero Developer Terms and click **Create app**
6. On the **Configuration** tab, you'll see:
   - **Client id** — copy this
   - **Client secret** — click **Generate a secret** → copy the value (you can only see it once)

**Tier** stays as **Starter ($0, 5 connections max)** by default. Fine for first 5 paying clients. Upgrade to Core (~$79/mo Xero pricing) once we hit client #6.

## Step 2 — Paste creds into Vercel production (1 min)

In terminal on your Mac:

```bash
cd /Users/claudia/Desktop/olybuddy-dashboard

# Paste the Client ID when prompted
vercel env add XERO_CLIENT_ID production
# Select "Production" → paste → Enter

# Paste the Client Secret when prompted
vercel env add XERO_CLIENT_SECRET production
# Select "Production" → paste → Enter
```

## Step 3 — Redeploy to pick up new env (1 min)

```bash
vercel --prod --yes
```

Wait for "Aliased: https://olybuddy-dashboard.vercel.app" (it'll actually redirect to nexley.vercel.app).

## Step 4 — Verify (30 sec)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://nexley.vercel.app/integrations
# should print 307 (auth redirect) — means the page is live
```

## Done. What this unlocks

Any client (Julian, next customer, everyone) can now:
1. Go to `https://nexley.vercel.app/integrations`
2. See **Xero** in "⭐ Recommended for Trades"
3. Click Connect → redirected to Xero's consent screen
4. Log in / pick their Xero org → consent
5. Redirected back → Nexley has their Xero credentials (encrypted in Supabase) + tenant ID

Then Nexley can:
- Draft invoices for completed jobs (trust-gated — TL<3 holds for owner approval)
- Chase overdue invoices (daily cron, trust-gated WhatsApp drafts)
- Record payments when customers say "paid" (TL3 only)
- Look up contact history before replying to enquiries
- Surface supplier spend / Dext-sync'd bills ("total at Screwfix last month?")

## After 5 paying clients — upgrade to Core tier

1. Go back to https://developer.xero.com/app/manage
2. Select your app → **Plan**
3. Upgrade to Core (~10,000 minute egress, 100 connections cap)

## Optional — Xero app certification (for App Store listing)

Not needed for private-use. Only do this if we want to appear in Xero's app marketplace. Adds 2-4 weeks review. Defer.
