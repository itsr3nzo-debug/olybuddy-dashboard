-- Vault — per-client document library that the AI Employee can search/cite
-- from chat. Source of truth is Supabase; the VPS agent lazy-caches files
-- it reads. RLS tied to get_client_id() (same helper used by
-- agent_chat_messages, contacts, etc) so cross-tenant reads are blocked
-- server-side even if a session_id/file_id leaks.
--
-- Structure:
--   vault_projects   — a "matter" / workspace. Files belong to a project.
--   vault_files      — individual files with extracted_text for FTS.
--                      Soft-delete via deleted_at; originals live in
--                      the `vault` Storage bucket.
--
-- Bucket RLS (see Supabase dashboard → Storage policies) mirrors the
-- table rules: objects under `{client_id}/...` only visible to that
-- tenant.

create table if not exists vault_projects (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  description   text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index if not exists vault_projects_client_idx
  on vault_projects (client_id)
  where archived_at is null;

create table if not exists vault_files (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references vault_projects(id) on delete cascade,
  -- denormalised for RLS simplicity — avoids a join on every select
  client_id      uuid not null references clients(id) on delete cascade,
  storage_path   text not null unique,
  filename       text not null,
  mime_type      text,
  size_bytes     bigint,
  sha256         text,
  tags           text[] not null default '{}',
  extracted_text text,
  page_count     integer,
  status         text not null default 'uploaded'
    check (status in ('uploaded','processing','ready','failed')),
  error_message  text,
  uploaded_by    uuid references auth.users(id),
  uploaded_at    timestamptz not null default now(),
  processed_at   timestamptz,
  deleted_at     timestamptz
);

create index if not exists vault_files_project_idx
  on vault_files (client_id, project_id)
  where deleted_at is null;

-- Full-text search index on extracted text — the VPS agent queries this via
-- /api/agent/vault/search with a plain query, server runs websearch_to_tsquery.
create index if not exists vault_files_fts_idx
  on vault_files using gin (to_tsvector('english', coalesce(extracted_text,'')));

-- ── RLS ──────────────────────────────────────────────────────────────
alter table vault_projects enable row level security;
alter table vault_files    enable row level security;

-- Projects
drop policy if exists vault_projects_tenant_select on vault_projects;
create policy vault_projects_tenant_select on vault_projects
  for select using (client_id = get_client_id());

drop policy if exists vault_projects_tenant_insert on vault_projects;
create policy vault_projects_tenant_insert on vault_projects
  for insert with check (client_id = get_client_id());

drop policy if exists vault_projects_tenant_update on vault_projects;
create policy vault_projects_tenant_update on vault_projects
  for update using (client_id = get_client_id())
             with check (client_id = get_client_id());

drop policy if exists vault_projects_tenant_delete on vault_projects;
create policy vault_projects_tenant_delete on vault_projects
  for delete using (client_id = get_client_id());

-- Super-admins can read across tenants (mirrors agent_chat_*_admin_select)
drop policy if exists vault_projects_admin_select on vault_projects;
create policy vault_projects_admin_select on vault_projects
  for select using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'super_admin'
  );

-- Files — same set of policies
drop policy if exists vault_files_tenant_select on vault_files;
create policy vault_files_tenant_select on vault_files
  for select using (client_id = get_client_id() and deleted_at is null);

drop policy if exists vault_files_tenant_insert on vault_files;
create policy vault_files_tenant_insert on vault_files
  for insert with check (client_id = get_client_id());

drop policy if exists vault_files_tenant_update on vault_files;
create policy vault_files_tenant_update on vault_files
  for update using (client_id = get_client_id())
             with check (client_id = get_client_id());

drop policy if exists vault_files_tenant_delete on vault_files;
create policy vault_files_tenant_delete on vault_files
  for delete using (client_id = get_client_id());

drop policy if exists vault_files_admin_select on vault_files;
create policy vault_files_admin_select on vault_files
  for select using (
    ((auth.jwt() -> 'app_metadata') ->> 'role') = 'super_admin'
  );
