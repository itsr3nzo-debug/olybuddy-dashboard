# 05 — Customer LLM budget overrun

A single customer's daily LLM spend approaches or exceeds their cap. Could be
legitimate heavy use, but could be a runaway prompt-injection loop or a
confused tool-calling chain.

## Symptoms

- Axiom alert: `Per-client inference spend > 120% of cap` fires
- Customer's `llm_budget_periods` row shows `tier = 'queue_for_approval'` or
  `'hard_capped'`
- Customer messages owner asking why their AI Employee suddenly stopped /
  sounds different / takes ages

## Quick diagnose

```sql
select client_id,
       period_start,
       spent_pence::float / 100 as spent_gbp,
       cap_pence::float / 100 as cap_gbp,
       (spent_pence::float / cap_pence) * 100 as percent_of_cap,
       degraded_at,
       hard_capped_at
from public.llm_budget_periods
where period_start = current_date
  and spent_pence > cap_pence * 0.5
order by percent_of_cap desc
limit 20;
```

For the offending client_id, look at recent assistant message usage:

```sql
select id, created_at, finish_reason, usage->>'cost_pence' as pence,
       length(content) as content_len, tool_uses
from public.agent_chat_messages
where client_id = '<id>'
  and role = 'assistant'
  and created_at > now() - interval '24 hours'
order by created_at desc
limit 50;
```

Three patterns to look for:

1. **Many short messages, normal cost each** → legitimate heavy use. Check
   their plan vs actual usage; consider upgrading.
2. **Long messages with many tool_uses each** → one or more agent loops are
   spinning. Look at `tool_uses` for repeats.
3. **Single message with massive cost** → poisoned context or attack input.
   Inspect the corresponding user message.

## Mitigation

### A. Legitimate heavy use → upgrade or extend cap

```sql
-- Increase today's cap by 50% as a one-off
update public.llm_budget_periods
   set cap_pence = cap_pence * 1.5
 where client_id = '<id>'
   and period_start = current_date;
```

Then send the owner a heads-up via in-app notification:

```sql
insert into public.notifications(user_id, client_id, category, title, body, deep_link)
select id, '<id>', 'system',
       'Heavy day on the AI Employee',
       'You are using more than usual today — we have extended your cap so the AI Employee keeps replying. Consider upgrading at /settings/billing.',
       '/settings/billing'
from auth.users where (raw_app_meta_data->>'client_id')::uuid = '<id>';
```

### B. Runaway loop / poisoned input

1. Pause the AI Employee:
   ```sql
   update public.agent_config
      set paused = true, paused_until = now() + interval '1 hour'
    where client_id = '<id>';
   ```
2. Find the trigger conversation:
   ```sql
   select session_id, count(*) as msg_count, sum((usage->>'cost_pence')::int) as total_pence
   from public.agent_chat_messages
   where client_id = '<id>'
     and created_at > now() - interval '6 hours'
   group by session_id
   order by total_pence desc nulls last
   limit 5;
   ```
3. Inspect the top session in the dashboard or via SQL. If you see prompt
   injection (customer trying to manipulate AI behaviour) or a confused tool
   loop, archive the session:
   ```sql
   update public.agent_chat_sessions
      set archived_at = now(), title = title || ' [auto-archived: cost runaway]'
    where id = '<session_id>';
   ```
4. Resume the AI Employee:
   ```sql
   update public.agent_config
      set paused = false, paused_until = null
    where client_id = '<id>';
   ```

### C. Hard-capped but customer needs service

Same as A — extend cap as a one-off. Plus add a follow-up to upgrade their
plan within the week.

## Recovery

1. Verify next message attempt returns `tier=normal` or `tier=degraded`,
   not `hard_capped`
2. Test by checking `record_llm_spend` directly:
   ```sql
   select * from record_llm_spend('<client_id>'::uuid, 100, 5000);
   ```
3. Customer messages working again — confirm via /api/mobile/me showing
   `paused=false`

## Postmortem

For each overrun incident:
- Was the cap correct for the plan? (plan upgrade or cap recalibration?)
- Was it abuse? (prompt injection from customer end)
- Was it our bug? (tool loop, infinite retry, large attachment context)

Trend over 90 days: if overruns are >5% of customers per month, the caps
are too tight. If <0.5%, they're too loose.
