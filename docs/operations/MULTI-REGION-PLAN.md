# Multi-region resilience plan

**Owner:** Renzo. **Status:** plan only — not justified at current customer count, kept warm so we can pull the trigger when the SLO targets demand it.

---

## Why this is here

Today every customer is served from a single Supabase region (eu-west-2 / London) and the dashboard runs on Vercel's edge network. When AWS London or our specific Supabase project has an outage, the dashboard goes dark, the Stripe webhook can't write events, and per-client VPS agents can't reach back home. We've already tasted this twice (Mar 2026 Supabase eu-west burp, Apr 2026 Vercel edge cache anomaly) — neither caused real customer loss because we were lucky and short.

The SLO target (item #10) is 99.0% per-client agent uptime. A single-region single-provider stack can deliver that with caveats. To credibly promise 99.5+ to enterprise customers, we need at least one of:

1. Read replicas in a second region (read-only failover for dashboard reads)
2. Active-active multi-region (writes possible from either side)
3. A self-hosted Postgres warm-standby in a different region

This doc compares those, picks one, and lists the steps for when we pull the trigger.

---

## Honest current state

| Component | Region | Failure blast radius |
|---|---|---|
| Vercel dashboard | global edge | low — Vercel routes around outages automatically |
| Vercel functions (`/api/*`) | iad1 (default) | medium — single region, ~1-2 outages/year |
| Supabase Postgres | eu-west-2 | **high** — full outage = dashboard read+write fails, VPS agents can't write |
| Supabase Storage (vps-backups) | eu-west-2 | medium — backups become unreachable but not destroyed |
| Hetzner CPX22 VPSes (per client) | various nbg/fsn DC | **high per-client** — one DC out = those clients' agents down |
| Stripe | global | low — Stripe has its own multi-region setup |
| Gmail SMTP | google global | low — already multi-region |

The heavy hitters are Supabase Postgres and Hetzner per-client VPS regions. Everything else is already resilient enough.

---

## Option A — Supabase read replicas (recommended next step)

Supabase Pro tier includes read replicas. Configuration:

1. Add a read replica in `us-east-1` or `eu-central-1` (different region, same provider).
2. Update the Supabase JS client to do reads via the replica's hostname when the primary is unreachable. Writes still hit primary.
3. Most of our dashboard read paths (KPIs, list pages, billing display) become tolerant to primary outages — they degrade to "you're in read-only mode" rather than 500.
4. Webhook ingest still requires writes — those routes need explicit fallback (queue locally, retry once primary returns). The Stripe webhook already has `stripe_events.processed` flag-based replay, so the only addition is "if write to Supabase fails, log to Sentry + return 200 (Stripe retries) instead of 500".

Cost: Pro tier includes 1 free read replica. Above that ~$10/month per replica.
Effort: ~1 day to wire the failover client + test path.
Win: Dashboard stays partially functional during a primary outage. Webhook ingest stays available.

## Option B — Active-active (rejected for now)

Supabase doesn't support multi-master. Active-active requires migrating off managed Supabase entirely (self-host on AWS RDS multi-AZ + Aurora Global, or pay for CockroachDB). Cost: $500-2000/month, weeks of migration work, lose the convenience of Supabase auth + Storage + RLS.

Verdict: not worth it until we have ≥100 customers + SLA-backed enterprise contracts demanding it.

## Option C — Postgres warm standby on a different provider (rejected for now)

Run a streaming-replication standby on AWS RDS (separate region, separate provider). On primary failure, manually promote standby + flip DNS.

Cost: ~$100/month for a small RDS instance + bandwidth.
Effort: 3-5 days to set up + automate failover.
Verdict: more flexibility than Option A but more ops burden. Revisit if Supabase reliability degrades.

---

## Recommended sequence

When SLO breaches start trending or we onboard our first contract demanding ≥99.5% uptime:

1. **Now (free):** Enable Supabase point-in-time recovery (PITR). Already done? Check Supabase dashboard.
2. **+1 day work:** Add a read replica in a second Supabase region. Wire the dashboard's read paths to use it as a fallback. Webhook ingest gets a "queue locally on primary fail, retry via cron" pattern.
3. **+1 week work:** VPS-level resilience — pick 2-3 Hetzner data centres, distribute new clients across them deliberately so a single-DC outage doesn't take down the whole fleet. Update `provision-vps.py` to round-robin or load-balance.
4. **+1 month work:** Cloudflare in front of the dashboard with caching for static pages so Vercel/Supabase outages don't black out the marketing site.

---

## What NOT to do prematurely

- Don't migrate off Supabase. The convenience tax is currently a win.
- Don't introduce write conflicts via active-active. Resolving those is harder than tolerating short read-only periods.
- Don't pre-build "global Postgres" abstractions. We don't need them yet, and they constrain the design once we do need them.

---

## Triggers to revisit

- Supabase outage of >30min in any month
- First customer asks "what's your uptime SLA in writing?"
- Per-client agent uptime SLO drops below 99.0% for two consecutive 30d windows
- Hetzner has a single-DC incident affecting >25% of our fleet

When any of those fire, dust off this doc, do step 1 + 2 above, re-run the SLO numbers a month later.
