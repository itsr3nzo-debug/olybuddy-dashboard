# Service Level Objectives + SLAs

**Owner:** Renzo. **Audit cadence:** weekly via the admin SLO dashboard at `/admin/slo`.

This is the contract we hold ourselves to and (for the customer-facing SLA section) what we publish to clients. Anything **failing** here for >7 days is a P1 issue routed to Light.

---

## Internal SLOs (engineering targets)

| Surface | Indicator | Objective | Window | Source |
|---|---|---|---|---|
| Dashboard front-end | Page error rate (5xx + 4xx-on-render) | <0.5% | 30d rolling | Vercel analytics + audit_logs |
| Dashboard front-end | LCP (Largest Contentful Paint) on home | <2.5s on 4G mobile, p75 | 30d | Vercel speed insights |
| API routes | 5xx error rate (excluding 401/403) | <1.0% | 30d | audit_logs `level=error` count vs total |
| API routes | p95 latency (excluding /api/cron/*) | <800ms | 30d | request middleware logs (TBD) |
| Stripe webhook | Successful processing rate | >99.5% | 30d | stripe_events.processed=true ratio |
| Provisioning | Time from signup to "ready" (paid path) | <20min p95 | 30d | provisioning_queue.created_at → vps_status=active |
| WhatsApp pairing | Time from QR scan to first message | <60s p95 | 30d | wa_state events |
| Per-client agent uptime | systemd unit `active` + heartbeat <5min stale | >99.0% | 30d | agent_heartbeats |
| Outreach | Cold email bounce rate | <2.0% | per campaign | Instantly analytics |
| Outreach | Spam complaint rate | <0.1% | per campaign | Instantly analytics |

### How we measure each

- **Page error rate:** Vercel route analytics (built-in) + Sentry (when added). Today we proxy via `audit_logs` rows tagged `route_error`.
- **LCP / Web Vitals:** `@vercel/analytics` + Speed Insights (already wired). Threshold = Google's "Good" cutoff.
- **API 5xx:** `SELECT count(*) FROM audit_logs WHERE level='error' AND created_at > now() - interval '30 days'`.
- **Stripe webhook reliability:** the `stripe_events` table tracks every event's processed flag. `processed_at IS NULL` after 5 minutes = a failure.
- **Signup-to-ready latency:** the `provisioning_queue.processed_at - clients.created_at` for paying customers (subscription_status active).
- **WA pairing time:** the gap between `agent_config.wa_qr_at` → `agent_config.wa_paired_at`. Already captured.
- **Per-client agent uptime:** `agent_heartbeats.last_beat_at`. >5min stale = unit considered down for that minute. Aggregate to availability %.

---

## Customer-facing SLA (published)

**Subscription tier covered:** £599/mo "AI Employee" customers. Trial customers (£20 onboarding) get best-effort.

| Promise | Measurement | Compensation if missed |
|---|---|---|
| 99.5% monthly uptime for your AI Employee VPS | Per-client systemd uptime + heartbeat | 25% credit on next invoice if breached in any rolling 30d window |
| First WhatsApp reply within 30s during business hours | comms_log received_at vs replied_at, weighted by message_count | Best-effort; no credit |
| Support email reply within 1 business day | support@nexley.ai response time | If we miss, we email an apology + next-step ETA |
| 14-day data retention after cancellation | Cleanup cron runs T+14d after cancellation | n/a |

The credit mechanism is manual today — ops apply via Stripe Customer Portal balance adjustment when a breach is reported. Once we have the SLO admin page in place we can automate this.

---

## Admin SLO dashboard

Lives at `/admin/slo`. Reads from:
- `audit_logs` (5xx / route errors)
- `stripe_events` (webhook health)
- `agent_heartbeats` (per-client uptime)
- `provisioning_queue` (signup-to-ready time)
- `integration_signals` (outreach + backup health)

Renders:
1. **Top-line summary** — green/amber/red dots for each SLO above.
2. **Per-client uptime grid** — heatmap of last 30 days, one row per active client.
3. **Trend lines** — error rate, latency, webhook success.
4. **Anomaly list** — anything currently breaching, sorted by severity.

If any indicator stays in the **red** for >7 days, the weekly Light cron creates a P1 task in the inbox.

---

## When an SLO breaches

1. Light fires a P0 alert via `agent_alerts` (item #11).
2. The on-call human (Renzo) acknowledges within 15 minutes.
3. Symptom mitigated (rollback via `scripts/rollback.sh`, scale up Hetzner, fix the bug, etc.).
4. Post-mortem within 48h in `docs/postmortems/{date}-{indicator}.md` covering: timeline, root cause, what we'll change.
5. SLO dashboard's history view records the breach so we can spot recurring patterns.

---

## Out of scope

- 99.9%+ uptime: would need active-active multi-region (item #9). Not justified for current customer base.
- Sub-second p95 API latency: dashboard isn't latency-critical for the human users; the per-client agent has its own paths.
- Mobile app uptime: no native mobile app exists yet.
