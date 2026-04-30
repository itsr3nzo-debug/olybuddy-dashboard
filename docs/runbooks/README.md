# Mobile backend — failure runbooks

Five most likely failure modes for the mobile backend, with detection,
diagnosis, and recovery steps. On-call uses these.

| Runbook | When to read |
|---|---|
| [01-anthropic-outage.md](./01-anthropic-outage.md) | Chat is silent, error rate >5% on `/api/chat/stream/*` |
| [02-onesignal-down.md](./02-onesignal-down.md) | Pushes not arriving, OneSignal API returning 5xx |
| [03-supabase-degraded.md](./03-supabase-degraded.md) | Wider issues — auth failing, queries timing out |
| [04-upstash-redis-down.md](./04-upstash-redis-down.md) | Rate limit / revocation checks failing open |
| [05-budget-overrun.md](./05-budget-overrun.md) | A customer's daily spend approaches/exceeds cap |

Each runbook follows the same structure:

1. **Symptoms** — what the user / Telegram / Axiom sees
2. **Quick diagnose** — three-question triage
3. **Mitigation** — restore service first, root-cause later
4. **Recovery** — bring it back to healthy
5. **Postmortem** — what to write up

If a runbook isn't here for what you're hitting, **always**:

- Capture the request_id (in error response or X-Request-Id header)
- Check `/api/mobile/health` — narrows the fault domain
- Check Vercel deployment status (recent deploy regressions are #1 cause)
- Telegram `#nexley-ops` with what you saw and what you've tried
