# 01 — Anthropic outage

## Symptoms

- Customers report AI Employee replies are blank, slow, or never arrive
- Vercel logs show `chat.upstream_error` rate >5% on `/api/chat/stream/[id]`
- Axiom alert: `Anthropic 5xx rate >5% over 5m` fires
- Mobile app shows the SSE error event with `code: chat.upstream_error`

## Quick diagnose

1. **Is it Anthropic?** Check `https://status.anthropic.com` — note the affected
   region (us-east-1 / us-west-2 / europe).
2. **Is it everyone or one customer?** In Axiom: filter by `client_id`. If one
   customer only, suspect their tools or a poison-message input — escalate to
   §05 budget runbook to check for runaway loops.
3. **Is the SDK timeout firing?** If you see `code: idle_timeout` rather than
   `chat.upstream_error`, Anthropic's stream is dropping silently — different
   class of issue, the watchdog at 90s is doing its job.

## Mitigation

### A. If Anthropic confirms outage and ETA <30 min

Do nothing. The mobile app's `chat.upstream_error` is `retryable: true`, so
users will see "Couldn't reach the AI Employee — try again." Status page
banner if outage persists past 15 min.

### B. If outage >30 min OR no Anthropic ETA

Trip the failover feature flag (Bedrock not yet wired in production — when
it is, enabling this swaps the LLM provider):

```sql
update public.feature_flags
   set default_value = true, updated_at = now()
 where flag_key = 'llm_fallback_bedrock';
```

Push notification to customers via:

```bash
# Send a system-tone push to all active customers
curl -X POST "$DASHBOARD_URL/api/admin/broadcast-push" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -d '{"category":"system","title":"AI Employee briefly unavailable","body":"We are routing through a backup model — replies may sound slightly different until normal service resumes."}'
```

### C. If we must completely halt chat

```sql
update public.feature_flags
   set default_value = false, updated_at = now()
 where flag_key = 'mobile_app_enabled';
```

This causes `/api/mobile/chat/send` to return `chat.upstream_error` with
`retryable: false`. The mobile UI shows a maintenance banner and disables
the composer. Use only when Anthropic + Bedrock are both down.

## Recovery

1. Anthropic resolves → revert feature flags:
   ```sql
   update public.feature_flags
      set default_value = false, updated_at = now()
    where flag_key = 'llm_fallback_bedrock';
   update public.feature_flags
      set default_value = true, updated_at = now()
    where flag_key = 'mobile_app_enabled';
   ```
2. Verify with synthetic test: `curl -N "$DASHBOARD_URL/api/chat/stream/<test_conv_id>?token=<jwt>&assistant_message_id=<id>"` and watch for `message_complete`.
3. Check Axiom 5xx rate has dropped <0.5% sustained for 10 min.
4. Status page back to healthy.

## Postmortem

If outage exceeded 30 min:
- Calculate impact: customers affected × duration, write to `docs/postmortems/`
- Note whether Bedrock failover *would* have caught it (if not yet built, this
  is the second incident voucher to prioritise the build)
- Review whether our 90s idle-timeout was the right threshold
