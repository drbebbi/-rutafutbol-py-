-- =============================================================================
-- 0003 - Audit and security
-- =============================================================================

create table audit.evaluation_bundles (
  id                    uuid primary key default gen_random_uuid(),
  -- The hash covers decision-affecting content only. `first_materialized_at`
  -- is bookkeeping and is deliberately outside it, so identical knowledge
  -- always hashes identically.
  content_hash          core.sha256_hex not null unique,
  schema_version        core.schema_version not null,
  bundle_content_jsonb  jsonb not null,
  first_materialized_at timestamptz not null default now()
);

comment on table audit.evaluation_bundles is
  'Immutable snapshots of the knowledge an evaluation was decided against.';

create table audit.admin_audit_events (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid not null,
  action         text not null,
  target_kind    text not null,
  target_ref     text,
  -- Never user case facts: this table records administrative acts on the
  -- knowledge base, not anything about an applicant.
  detail_jsonb   jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index admin_audit_events_actor_idx on audit.admin_audit_events (actor_user_id, created_at desc);
create index admin_audit_events_action_idx on audit.admin_audit_events (action, created_at desc);

create table security.admin_authorizations (
  user_id     uuid not null,
  admin_role  text not null check (admin_role in ('RESEARCHER', 'PUBLISHER', 'ADMIN')),
  granted_at  timestamptz not null default now(),
  granted_by  uuid,
  revoked_at  timestamptz,
  primary key (user_id, admin_role)
);

comment on table security.admin_authorizations is
  'The single source of truth for administrative authority. user_metadata is never authoritative: it is user-writable.';

create index admin_authorizations_active_idx
  on security.admin_authorizations (user_id) where revoked_at is null;

create table security.erasure_journal (
  id                uuid primary key default gen_random_uuid(),
  -- Only the subject identifier and the outcome. No wizard facts, ever.
  deleted_subject_id uuid not null,
  erased_at         timestamptz not null default now(),
  operation_status  text not null check (operation_status in ('REQUESTED', 'COMPLETED', 'FAILED')),
  scope             text not null check (scope in ('CASE', 'ACCOUNT'))
);

comment on table security.erasure_journal is
  'Evidence that an erasure happened. Contains no personal case content.';

-- ---------------------------------------------------------------------------
-- Authorization helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because `security` is not readable by request roles. It is
-- hardened the way every definer function in this schema is: empty search_path,
-- fully schema-qualified body, EXECUTE revoked from PUBLIC.
create function security.has_admin_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from security.admin_authorizations a
    where a.user_id = auth.uid()
      and a.admin_role = p_role
      and a.revoked_at is null
  );
$$;

revoke all on function security.has_admin_role(text) from public;
grant execute on function security.has_admin_role(text) to authenticated, cedula_admin_runtime_role;

-- The same question for a user the server has already verified.
--
-- The internal runtime roles have no session identity of their own, so a
-- server-side path states which administrator is acting and the database
-- answers for that user. `auth.uid()` is not consulted here at all, which is
-- what lets a privileged path run outside a request context without inventing
-- a session.
create function security.has_admin_role_for(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from security.admin_authorizations a
    where a.user_id = p_user_id
      and a.admin_role = p_role
      and a.revoked_at is null
  );
$$;

revoke all on function security.has_admin_role_for(uuid, text) from public;
grant execute on function security.has_admin_role_for(uuid, text)
  to cedula_runtime_role, cedula_admin_runtime_role;

create function security.is_any_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from security.admin_authorizations a
    where a.user_id = auth.uid()
      and a.revoked_at is null
  );
$$;

revoke all on function security.is_any_admin() from public;
grant execute on function security.is_any_admin() to authenticated, cedula_admin_runtime_role;
