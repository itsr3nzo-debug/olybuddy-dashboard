# Secret rotation runbook

**Owner:** Renzo. **Audit cadence:** weekly via `/api/cron/secret-audit` (Mon 09:00 UTC) → Telegram alert if any secret is overdue.

This is the single source of truth for which keys we rely on, where they live, and how to rotate them. If a key gets compromised, follow the **emergency rotation** path at the bottom.

---

## Inventory

The `public.secrets_inventory` table is the authoritative list. Read it via:

```sql
SELECT
  name,
  category,
  severity,
  rotation_days,
  last_rotated_at,
  (last_rotated_at + (rotation_days * INTERVAL '1 day'))::date AS next_due,
  CASE WHEN (last_rotated_at IS NULL OR last_rotated_at + (rotation_days * INTERVAL '1 day') < NOW())
       THEN 'OVERDUE' ELSE 'ok' END AS status
FROM public.secrets_inventory
ORDER BY status DESC, next_due NULLS FIRST;
```

The admin dashboard (`/admin/secrets`) renders this with a one-click "Mark rotated" button.

---

## Per-secret rotation steps

### Stripe (CRITICAL — every 90–180 days)

| Secret | Where | Cadence | Steps |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel env | 180d | 1. Stripe dashboard → Developers → API keys → "Roll" the restricted key. 2. Copy the new key. 3. `printf "%s" "rk_live_..." \| vercel env add STRIPE_SECRET_KEY production` (note: `printf` not `echo` — `echo` adds `\n` which breaks the Authorization header). 4. Redeploy. 5. UPDATE secrets_inventory SET last_rotated_at = NOW() WHERE name = 'STRIPE_SECRET_KEY'. |
| `STRIPE_WEBHOOK_SECRET` | Vercel env | 90d | 1. Stripe dashboard → Webhooks → endpoint → "Signing secret" → Roll. 2. Update Vercel env (whsec_…). 3. Redeploy. 4. Test by sending a test event from the Stripe dashboard and checking `webhook_log` has a fresh row. |

### Supabase (CRITICAL — annual)

| Secret | Where | Cadence | Steps |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env, all VPS .env files, scheduled tasks | 365d | 1. Supabase dashboard → Settings → API → "Roll service role key". 2. Update Vercel env. 3. SSH each VPS → `sudo nano /opt/config/supabase.env` → save. 4. Run `bash scripts/apply-trust-to-all-vpses.sh` to bounce systemd units. 5. Redeploy Vercel. 6. **Watch out:** any external scripts on the Mac Mini that read this also need updating — check `~/.env` and launchd plists. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env, public clients | 730d | Same dashboard, "Roll anon key". Lower priority — public anyway. |

### OpenAI / Anthropic (HIGH — every 180 days)

`OPENAI_API_KEY` and `CLAUDE_API_KEY` are used by L's scoring + various Claude-based fallback paths. Rotate via the respective dashboards, update Vercel env, redeploy.

### SMTP / Gmail (HIGH — every 180 days)

`SMTP_PASS` is a Google App Password for `hello@nexley.ai`.

1. https://myaccount.google.com → Security → 2-Step Verification → App passwords.
2. Revoke "Nexley dashboard" password, create a new one.
3. Update Vercel env (`SMTP_PASS`).
4. Redeploy.
5. Test: trigger a verification email via `/api/auth/resend-verification` from a fresh signup.

### Telegram (HIGH — annually unless leaked)

`TELEGRAM_BOT_TOKEN`. Talk to @BotFather → `/revoke` → `/newtoken`. Update Vercel env. Test by triggering any path that calls the bot (a signup, a webhook event).

### Internal (HIGH — every 90 days)

| Secret | Notes |
|---|---|
| `CRON_SECRET` | Auths Vercel cron-trigger calls. Generate `openssl rand -hex 32`. Update Vercel env AND any external schedulers (Mac Mini launchd plists hitting `/api/cron/*`). |
| `INTERNAL_API_KEY` | LEGACY. Disabled by default (`ALLOW_LEGACY_INTERNAL_API_KEY` must be `true` to allow use). Per-client `agent_api_key` is the replacement. Don't rotate — plan to delete. |

### Composio (HIGH — every 180 days)

`COMPOSIO_API_KEY` powers the per-client MCP adapter. Rotate via Composio dashboard, update Vercel env AND each VPS `/opt/clients/{slug}/.env`. After rotation, every client agent needs a service restart to pick up the new key.

### ElevenLabs (MEDIUM — every 180 days)

`ELEVENLABS_API_KEY` for the voice agent (Ava). Rotate via ElevenLabs dashboard, update Vercel env.

### Vercel deploy token (HIGH — every 180 days)

`VERCEL_DEPLOY_TOKEN` only lives on the Mac Mini in `~/.zshrc`. Used by `scripts/rollback.sh` and any CI that touches Vercel. Rotate via Vercel dashboard → Account Settings → Tokens.

### Hetzner (CRITICAL — every 180 days)

`HETZNER_API_TOKEN` provisions new client VPSes. Lives on the Mac Mini in `~/.env`. Rotate via Hetzner Cloud Console → Security → API tokens.

---

## Per-client agent API keys

These are NOT in `secrets_inventory` — they're per-tenant and rotation is self-service. The owner clicks **Settings → AI Employee → Rotate Key** and the dashboard:

1. Generates a new `oak_*` key.
2. Stores SHA-256 hash in `agent_config.agent_api_key_hash`.
3. Forwards the raw key to `provisioning_queue.meta` (action: `apply_sender_roles`).
4. Mac Mini worker polls the queue, SSHes to the VPS, writes `/opt/clients/{slug}/.env`, restarts the systemd unit.
5. Worker deletes the queue row — raw key no longer retained on dashboard side.

The previous key keeps working for ~30s during the transition; after the unit restart, only the new key authenticates.

---

## Emergency rotation (compromised key)

If you suspect a key is leaked:

1. **Immediately** invalidate it at the source (Stripe/Supabase/etc).
2. Rotate per the per-secret steps above.
3. `UPDATE secrets_inventory SET last_rotated_at = NOW(), notes = notes || E'\nEMERGENCY ROTATION ' || NOW()::date WHERE name = '...'`.
4. Audit the access log for the affected service:
   - Stripe: dashboard → Developers → Logs (filter to the leaked key).
   - Supabase: dashboard → Logs → Postgres.
   - OpenAI: dashboard → Usage.
5. Send a Telegram alert to ops:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
     -d chat_id="$TELEGRAM_CHAT_ID" -d text="🚨 Emergency rotation of $SECRET_NAME complete"
   ```
6. Open a post-mortem doc in `docs/postmortems/{date}-{secret}.md` with: how the leak happened, what we did, what'll prevent it next time.

---

## Adding a new secret

1. Insert a row in `secrets_inventory` (via the migration pattern in `supabase/migrations/`).
2. Document the rotation steps in this file under the relevant category.
3. Add the env var to Vercel (production + preview) and to the local `.env.example`.
4. **Never commit secrets to git** — the gitleaks pre-commit hook (`.gitleaks.toml`) catches most patterns, but the discipline still matters.

---

## Audit cadence

`/api/cron/secret-audit` runs Mondays at 09:00 UTC. It selects rows where `last_rotated_at + rotation_days * INTERVAL '1 day' < NOW()` and posts a Telegram summary if any are overdue. Lapsed >30 days creates a P1 task in `shared/memory/inbox/light/`.

---

## Legacy `agent_config.agent_api_key` plaintext column — drop schedule

The agent-API-key migration (P1 #4) added `agent_api_key_hash` and `previous_api_key_hash` columns and made the lookup chain hash-first. The legacy plaintext `agent_api_key` column is **kept temporarily** as a third-tier fallback so any not-yet-migrated client can still authenticate.

**Drop schedule (target: 2 weeks after migration):**
1. **Week 1 (now):** monitor — query `SELECT count(*) FROM agent_config WHERE agent_api_key IS NOT NULL AND agent_api_key_hash IS NOT NULL` — these are clients with both columns. They've been migrated but the plaintext is still around.
2. **Week 1+ ongoing:** check the legacy-fallback telemetry feed:
   ```sql
   SELECT count(*), date_trunc('day', occurred_at) AS day
   FROM integration_signals
   WHERE source IN ('agent-auth', 'api-auth')
     AND kind = 'legacy_key_fallback_hit'
     AND occurred_at > NOW() - INTERVAL '14 days'
   GROUP BY day ORDER BY day DESC;
   ```
   Every successful agent auth that hit the legacy plaintext fallback writes a row here (round-3 fix #9). When the daily count reaches 0 for 7 consecutive days, the column is safe to drop.
3. **Week 2:** confirm `git grep "agent_api_key"` returns no callers OUTSIDE of `lib/agent-auth.ts`, `lib/api-auth.ts`, `app/api/settings/rotate-agent-key/route.ts`, and `app/api/signup/route.ts` (the four places that legitimately reference it).
4. **Migration:** `ALTER TABLE agent_config DROP COLUMN agent_api_key;` + remove the legacy fallback branches in both lookup files. The telemetry insert can stay (no-op if column is gone).

**Why we don't drop today:** any VPS that was provisioned before the hash migration ran still has its raw key in `/opt/clients/{slug}/.env`, but the hash backfill should have populated `agent_api_key_hash` for that client too. The fallback is belt-and-braces for a 0.01% edge case where the backfill missed a row.
