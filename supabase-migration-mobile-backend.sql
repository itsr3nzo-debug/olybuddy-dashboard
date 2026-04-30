-- ============================================================================
-- Nexley AI — Mobile Backend Migration
-- ============================================================================
-- Adds the schema needed for the Nexley AI mobile app: push subscriptions,
-- notification history + preferences, idempotency replay protection,
-- AI-Employee takeover state, GDPR audit trail, per-customer LLM budgets,
-- feature flags, and revoked-JWT denylist.
--
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/awmsstlhbxsxlwydczdr/sql/new
--
-- Idempotent — safe to re-run. Every CREATE uses IF NOT EXISTS or CREATE OR
-- REPLACE; every ALTER guards with information_schema lookup.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Mobile-side state on existing tables
-- ----------------------------------------------------------------------------

-- AI consent timestamp (Apple Guideline 5.1.2(i) requires this on first run)
-- + deletion_requested_at for the soft-delete → 14-day hard-delete flow
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='clients' and column_name='ai_consent_at') then
    alter table public.clients
      add column ai_consent_at timestamptz,
      add column ai_consent_version text,
      add column mobile_onboarded_at timestamptz,
      add column deletion_requested_at timestamptz,
      add column hard_deleted_at timestamptz;
    create index if not exists idx_clients_pending_deletion
      on public.clients(deletion_requested_at)
      where deletion_requested_at is not null and hard_deleted_at is null;
  end if;
end $$;

-- Per-message attachments + tool-use trace (used by mobile chat UI to show
-- which tools the AI Employee invoked while replying)
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='agent_chat_messages' and column_name='attachments') then
    alter table public.agent_chat_messages
      add column attachments jsonb,
      add column tool_uses jsonb,
      add column finish_reason text,
      add column usage jsonb,
      add column idempotency_key text;
  end if;
end $$;

-- Unique idempotency key so a retry from a flaky mobile network can't double-send
do $$ begin
  if not exists (select 1 from pg_indexes
                  where tablename='agent_chat_messages'
                    and indexname='agent_chat_messages_idempotency_key_unique') then
    create unique index agent_chat_messages_idempotency_key_unique
      on public.agent_chat_messages(idempotency_key)
      where idempotency_key is not null;
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2. Push subscriptions — one row per device
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  onesignal_subscription_id text not null,
  platform text not null check (platform in ('ios','android')),
  app_version text,
  device_model text,
  push_token text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, onesignal_subscription_id)
);

create index if not exists idx_push_subscriptions_client
  on public.push_subscriptions(client_id);
create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "owner_reads_own_subs" on public.push_subscriptions;
create policy "owner_reads_own_subs" on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "owner_manages_own_subs" on public.push_subscriptions;
create policy "owner_manages_own_subs" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "service_role_full_access_push_subs" on public.push_subscriptions;
create policy "service_role_full_access_push_subs" on public.push_subscriptions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');


-- ----------------------------------------------------------------------------
-- 3. Notification preferences (per user) — owner controls when we push
-- ----------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  escalation boolean not null default true,
  customer_reply boolean not null default true,
  daily_digest boolean not null default true,
  estimate_actions boolean not null default true,
  digest_local_hour smallint not null default 17 check (digest_local_hour between 0 and 23),
  timezone text not null default 'Europe/London',
  quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "owner_reads_own_prefs" on public.notification_preferences;
create policy "owner_reads_own_prefs" on public.notification_preferences
  for select using (user_id = auth.uid());

drop policy if exists "owner_writes_own_prefs" on public.notification_preferences;
create policy "owner_writes_own_prefs" on public.notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 4. Notification history — what we've sent (in-app inbox)
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  category text not null check (category in (
    'escalation','customer_reply','daily_digest','system','estimate_action','billing'
  )),
  title text not null,
  body text not null,
  deep_link text,
  data jsonb,
  -- DA fix: dedupe via top-level column (UNIQUE btree), not nested jsonb path.
  -- See lib/push/onesignal.ts — coalesce within 60s window.
  idempotency_key text,
  onesignal_notification_id text,                  -- for status reconciliation
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications(user_id) where read_at is null;
-- Composite index drives the dedupe lookup in onesignal.ts
create index if not exists idx_notifications_user_idem
  on public.notifications(user_id, idempotency_key, created_at desc)
  where idempotency_key is not null;

alter table public.notifications enable row level security;

drop policy if exists "owner_reads_own_notifications" on public.notifications;
create policy "owner_reads_own_notifications" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "owner_marks_own_notifications" on public.notifications;
create policy "owner_marks_own_notifications" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "service_role_inserts_notifications" on public.notifications;
create policy "service_role_inserts_notifications" on public.notifications
  for insert with check (auth.role() = 'service_role');


-- ----------------------------------------------------------------------------
-- 5. Idempotency replay protection
-- ----------------------------------------------------------------------------
-- Stripe-style: key + body hash + response, 24h TTL. The unique constraint on
-- key alone means a re-submit returns the cached response without re-running
-- the side effect. Per DA: matches request_hash check rejects same-key with
-- different body (422 Conflict) — protects against client bugs.
create table if not exists public.api_idempotency (
  key text primary key,
  user_id uuid not null,
  endpoint text not null,
  request_hash text not null,
  response_status int not null,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists idx_api_idempotency_expires
  on public.api_idempotency(expires_at);

-- No RLS — only service_role writes/reads this. Mobile sees through the
-- middleware return value, never queries directly.

-- Daily sweep function (call from cron)
create or replace function public.purge_expired_idempotency()
returns int
language sql security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.api_idempotency where expires_at < now() returning 1
  )
  select count(*)::int from deleted;
$$;


-- ----------------------------------------------------------------------------
-- 5b. Internal-tool idempotency keys on estimates + agent_actions
-- ----------------------------------------------------------------------------
-- Internal tools (lib/llm/internal-tools.ts) hash their input and store the
-- 16-char hash here. ON CONFLICT DO NOTHING then makes the writes
-- replay-safe — the LLM can re-emit the same tool_use without duplicating.
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='estimates' and column_name='dedupe_key') then
    alter table public.estimates
      add column dedupe_key text,
      add column created_by_ai boolean default false;
    create unique index if not exists idx_estimates_dedupe_key
      on public.estimates(dedupe_key) where dedupe_key is not null;
  end if;
exception when undefined_table then null;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='agent_actions' and column_name='dedupe_key') then
    alter table public.agent_actions add column dedupe_key text;
    create unique index if not exists idx_agent_actions_dedupe_key
      on public.agent_actions(dedupe_key) where dedupe_key is not null;
  end if;
exception when undefined_table then null;
end $$;


-- ----------------------------------------------------------------------------
-- 6. Conversation-level AI takeover state (on conversation_sessions)
-- ----------------------------------------------------------------------------
-- Schema audit (2026-04-29): the customer↔business thread table is
-- `conversation_sessions`, not `conversations`. We extend it with the mobile-
-- specific columns the inbox + handle-message routes need.
--
-- DA flagged a race: owner pauses while AI is mid-reply. Use SELECT ... FOR
-- UPDATE inside the same tx as the message insert and check `ai_paused`
-- right before generating. `ai_paused_at` lets us reject any reply whose
-- generation started before pause.
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='conversation_sessions' and column_name='ai_paused') then
    alter table public.conversation_sessions
      add column ai_paused boolean not null default false,
      add column ai_paused_at timestamptz,
      add column ai_paused_until timestamptz,
      add column taken_over_by uuid references auth.users(id),
      add column taken_over_at timestamptz,
      -- Inbox display columns
      add column customer_name text,
      add column contact_id uuid references public.contacts(id) on delete set null,
      add column last_message_preview text,
      add column unread_count integer not null default 0,
      add column last_read_at timestamptz,
      add column closed_at timestamptz,
      add column closed_reason text;
    create index if not exists idx_conv_sessions_client_last_msg
      on public.conversation_sessions(client_id, last_message_at desc nulls last);
    create index if not exists idx_conv_sessions_unread
      on public.conversation_sessions(client_id) where unread_count > 0;
  end if;
end $$;

-- Estimates: existing schema is for PDF takeoff workflow. Mobile flow needs a
-- simpler per-line-item draft. Extend rather than fork.
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='estimates' and column_name='contact_id') then
    alter table public.estimates
      add column contact_id uuid references public.contacts(id) on delete set null,
      add column total_pence bigint,
      add column line_items jsonb,
      add column notes text,
      add column approved_at timestamptz,
      add column approved_by uuid references auth.users(id),
      add column rejected_at timestamptz,
      add column rejected_by uuid references auth.users(id),
      add column rejection_reason text;
  end if;
exception when undefined_table then null;
end $$;

-- agent_config: enabled_tools list (which Composio actions the AI Employee can call)
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_name='agent_config' and column_name='enabled_tools') then
    alter table public.agent_config
      add column enabled_tools text[] not null default array[]::text[];
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 7. Per-customer LLM budgets — atomic, soft-degradation
-- ----------------------------------------------------------------------------
-- Per DA: hard cutoff at cap = customer trust catastrophe. Soft tiers:
--   < 80% : Sonnet (full quality)
--   80-100% : Haiku (cheap fallback)
--   100-150% : queue for owner approval (don't auto-send)
--   > 150% : page Renzo, hard stop
--
-- `INSERT … ON CONFLICT DO UPDATE … RETURNING` for the increment makes the
-- counter atomic — no read-modify-write race.
create table if not exists public.llm_budget_periods (
  client_id uuid not null references public.clients(id) on delete cascade,
  period_start date not null,                         -- start of rolling-day window
  spent_pence bigint not null default 0,             -- accumulated cost in pence
  cap_pence bigint not null,                         -- daily cap derived from plan
  degraded_at timestamptz,                           -- when we first hit 80%
  hard_capped_at timestamptz,                        -- when we hit 150%
  primary key (client_id, period_start)
);

create index if not exists idx_llm_budget_periods_client
  on public.llm_budget_periods(client_id);

-- Atomic spend recorder — call this on every assistant message persist
-- DA hardening: SET search_path on every SECURITY DEFINER function
create or replace function public.record_llm_spend(
  p_client_id uuid,
  p_pence bigint,
  p_default_cap_pence bigint
)
returns table(spent_pence bigint, cap_pence bigint, tier text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_spent bigint;
  v_cap bigint;
  v_tier text;
begin
  -- Defensive parameter validation — SECURITY DEFINER bypasses RLS so we
  -- must not let a forged client_id corrupt another tenant's budget row.
  if p_client_id is null then raise exception 'client_id required'; end if;
  if p_pence < 0 then raise exception 'pence must be non-negative'; end if;
  if p_default_cap_pence <= 0 then raise exception 'cap must be positive'; end if;

  insert into public.llm_budget_periods(client_id, period_start, spent_pence, cap_pence)
    values (p_client_id, v_today, p_pence, p_default_cap_pence)
  on conflict (client_id, period_start) do update
    set spent_pence = llm_budget_periods.spent_pence + excluded.spent_pence
  returning llm_budget_periods.spent_pence, llm_budget_periods.cap_pence into v_spent, v_cap;

  v_tier := case
    when v_spent >= v_cap * 1.5 then 'hard_capped'
    when v_spent >= v_cap then 'queue_for_approval'
    when v_spent >= v_cap * 0.8 then 'degraded'
    else 'normal'
  end;

  -- Mark first crossing of degraded / hard_capped (used to fire owner alerts)
  if v_tier in ('degraded', 'queue_for_approval', 'hard_capped') then
    update public.llm_budget_periods
       set degraded_at = coalesce(degraded_at, now())
     where client_id = p_client_id and period_start = v_today;
  end if;
  if v_tier = 'hard_capped' then
    update public.llm_budget_periods
       set hard_capped_at = coalesce(hard_capped_at, now())
     where client_id = p_client_id and period_start = v_today;
  end if;

  return query select v_spent, v_cap, v_tier;
end $$;

-- Read-only helper. DA fix B11: previous SQL used UNION ALL+LIMIT which was
-- fragile and ignored a plan-change cap update. New impl uses an explicit
-- COALESCE on a left-joined VALUES so missing-row defaults work cleanly.
create or replace function public.get_budget_tier(
  p_client_id uuid,
  p_default_cap_pence bigint
)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_spent bigint;
  v_cap bigint;
begin
  if p_client_id is null then return 'normal'; end if;

  select coalesce(b.spent_pence, 0),
         coalesce(b.cap_pence, p_default_cap_pence)
    into v_spent, v_cap
    from public.llm_budget_periods b
   where b.client_id = p_client_id
     and b.period_start = (now() at time zone 'utc')::date;

  if v_cap is null then v_cap := p_default_cap_pence; end if;

  return case
    when v_spent >= v_cap * 1.5 then 'hard_capped'
    when v_spent >= v_cap then 'queue_for_approval'
    when v_spent >= v_cap * 0.8 then 'degraded'
    else 'normal'
  end;
end $$;

-- DA fix B10: read-then-act race. reserve_budget_atomic claims a tiny
-- placeholder spend (0 pence) and returns the resulting tier in one trip.
-- Concurrent callers all serialise through ON CONFLICT DO UPDATE so each one
-- sees the post-increment tier. Callers can then make the model-tier choice
-- with a true atomic read.
create or replace function public.reserve_budget_atomic(
  p_client_id uuid,
  p_default_cap_pence bigint
)
returns table(spent_pence bigint, cap_pence bigint, tier text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_spent bigint;
  v_cap bigint;
  v_tier text;
begin
  if p_client_id is null then raise exception 'client_id required'; end if;
  if p_default_cap_pence <= 0 then raise exception 'cap must be positive'; end if;

  insert into public.llm_budget_periods(client_id, period_start, spent_pence, cap_pence)
    values (p_client_id, v_today, 0, p_default_cap_pence)
  on conflict (client_id, period_start) do update
    -- no-op increment, but RETURNING gives us the canonical row state
    set spent_pence = llm_budget_periods.spent_pence
  returning llm_budget_periods.spent_pence, llm_budget_periods.cap_pence into v_spent, v_cap;

  v_tier := case
    when v_spent >= v_cap * 1.5 then 'hard_capped'
    when v_spent >= v_cap then 'queue_for_approval'
    when v_spent >= v_cap * 0.8 then 'degraded'
    else 'normal'
  end;

  return query select v_spent, v_cap, v_tier;
end $$;


-- ----------------------------------------------------------------------------
-- 8. JWT revocation denylist (auth webhook → Postgres → Redis sync)
-- ----------------------------------------------------------------------------
-- Solves DA's JWKS-cache-revocation-window issue. Supabase auth webhooks
-- write to this table on sign-out; a sync worker pushes entries to the
-- Upstash Redis denylist with TTL = jwt_exp - now().
create table if not exists public.jwt_denylist (
  jti text primary key,                              -- JWT id (sub+iat compound or auth event id)
  user_id uuid,
  reason text not null check (reason in ('signout','password_change','admin_revoke','compromise')),
  expires_at timestamptz not null,                   -- when JWT itself naturally expires
  synced_to_redis_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_jwt_denylist_pending_sync
  on public.jwt_denylist(created_at)
  where synced_to_redis_at is null;
create index if not exists idx_jwt_denylist_expires
  on public.jwt_denylist(expires_at);

-- Auto-purge expired entries
create or replace function public.purge_expired_jwt_denylist()
returns int
language sql security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.jwt_denylist where expires_at < now() returning 1
  )
  select count(*)::int from deleted;
$$;


-- ----------------------------------------------------------------------------
-- 9. Feature flags — homegrown, per-client overrides
-- ----------------------------------------------------------------------------
create table if not exists public.feature_flags (
  flag_key text primary key,
  description text,
  default_value boolean not null default false,
  rollout_percent smallint not null default 0 check (rollout_percent between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_flag_overrides (
  flag_key text not null references public.feature_flags(flag_key) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  value boolean not null,
  set_at timestamptz not null default now(),
  primary key (flag_key, client_id)
);

-- Seed a few flags we'll need
insert into public.feature_flags(flag_key, description, default_value)
  values
    ('mobile_app_enabled', 'Master switch for mobile API access', true),
    ('mobile_chat_streaming', 'Stream chat responses via SSE (vs request-response)', true),
    ('llm_via_centralised_api', 'Use centralised Anthropic API instead of per-VPS Claude Code', false),
    ('llm_fallback_bedrock', 'Failover to Bedrock when Anthropic returns 5xx', false),
    ('mobile_voice_enabled', 'Voice input/output in chat composer', false)
on conflict (flag_key) do nothing;


-- ----------------------------------------------------------------------------
-- 10. Mobile telemetry (events from the app for product analytics)
-- ----------------------------------------------------------------------------
create table if not exists public.mobile_telemetry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  app_version text,
  platform text,
  event_name text not null,
  properties jsonb,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now()
);

create index if not exists idx_mobile_telemetry_client_occurred
  on public.mobile_telemetry(client_id, occurred_at desc);
create index if not exists idx_mobile_telemetry_event
  on public.mobile_telemetry(event_name, occurred_at desc);

-- 90-day retention purge
create or replace function public.purge_old_mobile_telemetry()
returns int
language sql security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.mobile_telemetry where ingested_at < now() - interval '90 days' returning 1
  )
  select count(*)::int from deleted;
$$;

-- ----------------------------------------------------------------------------
-- 11a. Atomic chat-pair insert (DA fix B9 — orphan-row prevention)
-- ----------------------------------------------------------------------------
-- The mobile chat send endpoint inserts a user message and an assistant
-- placeholder. Doing this in two separate Supabase calls leaves an orphan
-- user message if the second insert fails. This RPC does both inside one
-- statement so they succeed or fail together.
--
-- Idempotency: the assistant placeholder gets a deterministic id derived
-- from the user message id + 'assistant' suffix. A duplicate call with the
-- same idempotency_key on the user message hits the unique partial index
-- and the assistant insert is skipped via ON CONFLICT.
create or replace function public.create_chat_pair(
  p_session_id uuid,
  p_client_id uuid,
  p_user_id uuid,
  p_content text,
  p_attachments jsonb,
  p_idempotency_key text
)
returns table(conversation_id uuid, user_message_id uuid, assistant_message_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := p_session_id;
  v_user_msg uuid;
  v_asst_msg uuid;
begin
  if p_client_id is null then raise exception 'client_id required'; end if;
  if p_user_id is null then raise exception 'user_id required'; end if;
  if p_content is null and p_attachments is null then
    raise exception 'content or attachments required';
  end if;

  -- Create session if not provided
  if v_session is null then
    insert into public.agent_chat_sessions(client_id, user_id, title)
      values (p_client_id, p_user_id, left(coalesce(p_content, 'New conversation'), 60))
      returning id into v_session;
  else
    -- Verify ownership inside the same tx
    if not exists (
      select 1 from public.agent_chat_sessions
       where id = v_session and client_id = p_client_id
    ) then
      raise exception 'conversation not found' using errcode = 'P0002';
    end if;
  end if;

  -- Insert user message — partial-unique on idempotency_key handles replay.
  -- Schema note: agent_chat_messages has no user_id column; the user is
  -- inferred from the session.user_id linkage.
  insert into public.agent_chat_messages(
    session_id, client_id, role, content, status, attachments, idempotency_key, metadata
  )
  values (
    v_session, p_client_id, 'user', coalesce(p_content, ''), 'done',
    p_attachments, p_idempotency_key,
    jsonb_build_object('user_id', p_user_id)
  )
  on conflict (idempotency_key) where idempotency_key is not null
    do update set content = excluded.content  -- no-op preserves first
  returning id into v_user_msg;

  -- If the user-message insert was a no-op (idempotent replay), look up the
  -- existing assistant placeholder linked to it.
  if exists (
    select 1 from public.agent_chat_messages
     where parent_id = v_user_msg and role = 'assistant'
  ) then
    select id into v_asst_msg from public.agent_chat_messages
     where parent_id = v_user_msg and role = 'assistant'
     limit 1;
  else
    insert into public.agent_chat_messages(
      session_id, client_id, role, content, status, parent_id
    )
    values (v_session, p_client_id, 'assistant', '', 'pending', v_user_msg)
    returning id into v_asst_msg;
  end if;

  return query select v_session, v_user_msg, v_asst_msg;
end $$;


-- ----------------------------------------------------------------------------
-- 11. GDPR audit trail
-- ----------------------------------------------------------------------------
-- Every data-export and account-deletion request gets logged here for the
-- regulatory paper trail. Article 15/17 require timely (<30 day) responses.
create table if not exists public.gdpr_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  email text not null,                               -- captured even after user deletion
  request_type text not null check (request_type in ('export','delete')),
  status text not null default 'received' check (status in ('received','processing','completed','rejected')),
  download_url text,                                 -- expires after 7 days
  download_expires_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_gdpr_requests_user
  on public.gdpr_requests(user_id);
create index if not exists idx_gdpr_requests_status
  on public.gdpr_requests(status, created_at);

alter table public.gdpr_requests enable row level security;

drop policy if exists "owner_reads_own_gdpr" on public.gdpr_requests;
create policy "owner_reads_own_gdpr" on public.gdpr_requests
  for select using (user_id = auth.uid());

drop policy if exists "owner_creates_own_gdpr" on public.gdpr_requests;
create policy "owner_creates_own_gdpr" on public.gdpr_requests
  for insert with check (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 12. Permissions — service role for Vercel functions
-- ----------------------------------------------------------------------------
grant execute on function public.purge_expired_idempotency() to service_role;
grant execute on function public.purge_expired_jwt_denylist() to service_role;
grant execute on function public.purge_old_mobile_telemetry() to service_role;
grant execute on function public.record_llm_spend(uuid, bigint, bigint) to service_role;
grant execute on function public.get_budget_tier(uuid, bigint) to service_role;
grant execute on function public.reserve_budget_atomic(uuid, bigint) to service_role;
grant execute on function public.create_chat_pair(uuid, uuid, uuid, text, jsonb, text) to service_role;

-- ----------------------------------------------------------------------------
-- 11b. Atomic conversation takeover (DA fix — owner pause race)
-- ----------------------------------------------------------------------------
-- Wraps the pause/resume under SELECT FOR UPDATE so a concurrent reply
-- inside /api/agent/handle-message can't beat the owner's pause to the
-- punch.
create or replace function public.take_over_conversation(
  p_conversation_id uuid,
  p_user_id uuid,
  p_client_id uuid
)
returns table(ai_paused boolean, ai_paused_at timestamptz, taken_over_by uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with locked as (
    select id from public.conversation_sessions
     where id = p_conversation_id and client_id = p_client_id
       for update
  ), updated as (
    update public.conversation_sessions
       set ai_paused = true,
           ai_paused_at = now(),
           taken_over_by = p_user_id,
           taken_over_at = now()
      from locked
     where conversation_sessions.id = locked.id
     returning conversation_sessions.ai_paused, conversation_sessions.ai_paused_at, conversation_sessions.taken_over_by
  )
  select u.ai_paused, u.ai_paused_at, u.taken_over_by from updated u;
end $$;

create or replace function public.hand_back_conversation(
  p_conversation_id uuid,
  p_user_id uuid,
  p_client_id uuid
)
returns table(ai_paused boolean, ai_paused_at timestamptz)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with locked as (
    select id from public.conversation_sessions
     where id = p_conversation_id and client_id = p_client_id
       for update
  ), updated as (
    update public.conversation_sessions
       set ai_paused = false,
           ai_paused_at = null,
           taken_over_by = null,
           taken_over_at = null
      from locked
     where conversation_sessions.id = locked.id
     returning conversation_sessions.ai_paused, conversation_sessions.ai_paused_at
  )
  select u.ai_paused, u.ai_paused_at from updated u;
end $$;

grant execute on function public.take_over_conversation(uuid, uuid, uuid) to service_role;
grant execute on function public.hand_back_conversation(uuid, uuid, uuid) to service_role;


-- ============================================================================
-- Verification queries — run after migration to sanity-check
-- ============================================================================
-- select count(*) as ff_seeded from public.feature_flags;             -- expect >= 5
-- select column_name from information_schema.columns
--   where table_name='clients' and column_name='ai_consent_at';        -- expect 1 row
-- select * from public.record_llm_spend(
--   '00000000-0000-0000-0000-000000000000'::uuid, 100, 5000);          -- expect tier='normal'
