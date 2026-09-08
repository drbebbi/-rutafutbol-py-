-- =============================================================================
-- 0007 - Row level security and grants
-- =============================================================================
-- RLS is enabled on every table in every schema, including the ones that have
-- no policies at all: a table with RLS on and no policy denies everything,
-- which is the correct default for research, audit and security.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- app: per-user data
-- ---------------------------------------------------------------------------
alter table app.user_cases enable row level security;
alter table app.user_cases force row level security;
alter table app.case_evaluations enable row level security;
alter table app.case_evaluations force row level security;

-- Anonymous users get no policy at all here. An anonymous case is never
-- persisted, so there is nothing for `anon` to read or write.
create policy user_cases_select_own on app.user_cases
  for select to authenticated
  using (owner_user_id = auth.uid());

create policy user_cases_insert_own on app.user_cases
  for insert to authenticated
  with check (owner_user_id = auth.uid());

create policy user_cases_update_own on app.user_cases
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy user_cases_delete_own on app.user_cases
  for delete to authenticated
  using (owner_user_id = auth.uid());

-- Read only. There is deliberately no INSERT, UPDATE or DELETE policy: the
-- authoritative evaluation is written server-side by
-- app.record_case_evaluation, and erasure runs through app.erase_user_case.
create policy case_evaluations_select_own on app.case_evaluations
  for select to authenticated
  using (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- core: published knowledge, served through server read paths only
-- ---------------------------------------------------------------------------
-- Published knowledge is public information, but `app` is the only Data API
-- surface: a browser role has no privilege here and no policy either. The
-- product serves this content through controlled server read paths, which run
-- as the internal runtime role and can therefore assemble a whole bundle in
-- one transaction - something the Data API could not express anyway.
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'core'
  loop
    execute format('alter table core.%I enable row level security', t.tablename);
    execute format('alter table core.%I force row level security', t.tablename);
    execute format(
      'create policy %I on core.%I for select to cedula_runtime_role, cedula_admin_runtime_role using (true)',
      t.tablename || '_runtime_read', t.tablename
    );
    -- Writes are reserved for the admin runtime and the publication path.
    execute format(
      'create policy %I on core.%I for all to cedula_admin_runtime_role using (security.is_any_admin()) with check (security.is_any_admin())',
      t.tablename || '_admin_write', t.tablename
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- research / audit / security: never reachable from a browser session
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename from pg_tables where schemaname in ('research', 'audit', 'security')
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
    execute format('alter table %I.%I force row level security', t.schemaname, t.tablename);
  end loop;
end
$$;

create policy research_claims_admin on research.research_claims
  for all to cedula_admin_runtime_role
  using (security.is_any_admin()) with check (security.is_any_admin());
create policy claim_reviews_admin on research.claim_reviews
  for all to cedula_admin_runtime_role
  using (security.is_any_admin()) with check (security.is_any_admin());
create policy review_notes_admin on research.review_notes
  for all to cedula_admin_runtime_role
  using (security.is_any_admin()) with check (security.is_any_admin());
create policy research_conflicts_admin on research.research_conflicts
  for all to cedula_admin_runtime_role
  using (security.is_any_admin()) with check (security.is_any_admin());

-- Bundles are shared, non-personal evidence; the runtime reads and appends them
-- but can never rewrite one.
create policy evaluation_bundles_runtime_read on audit.evaluation_bundles
  for select to cedula_runtime_role, cedula_admin_runtime_role using (true);
create policy evaluation_bundles_runtime_insert on audit.evaluation_bundles
  for insert to cedula_runtime_role, cedula_admin_runtime_role with check (true);

create policy admin_audit_events_admin_read on audit.admin_audit_events
  for select to cedula_admin_runtime_role using (security.has_admin_role('ADMIN'));

create policy admin_authorizations_admin on security.admin_authorizations
  for all to cedula_admin_runtime_role
  using (security.has_admin_role('ADMIN'))
  with check (security.has_admin_role('ADMIN'));

-- The erasure journal is written only by the erasure function (SECURITY
-- DEFINER, so it bypasses this) and read only by an administrator.
create policy erasure_journal_admin_read on security.erasure_journal
  for select to cedula_admin_runtime_role using (security.has_admin_role('ADMIN'));

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema app, core, research, audit, security from public;
revoke all on all tables in schema app, core, research, audit, security from anon, authenticated;

-- Normal runtime.
grant select on all tables in schema core to cedula_runtime_role;
grant select, insert on audit.evaluation_bundles to cedula_runtime_role;
grant select, insert, update, delete on app.user_cases to cedula_runtime_role;
-- Read only: no INSERT, no UPDATE, no DELETE. Evaluations are written by the
-- authorized server path, never by a client statement.
grant select on app.case_evaluations to cedula_runtime_role;

-- Admin runtime.
grant select, insert, update, delete on all tables in schema core to cedula_admin_runtime_role;
grant select, insert, update, delete on all tables in schema research to cedula_admin_runtime_role;
grant select, insert on audit.evaluation_bundles to cedula_admin_runtime_role;
grant select, insert on audit.admin_audit_events to cedula_admin_runtime_role;
grant select, insert, update on security.admin_authorizations to cedula_admin_runtime_role;
grant select on security.erasure_journal to cedula_admin_runtime_role;
-- Deliberately NOT granted: browsing private user cases.

alter default privileges in schema core grant select on tables to cedula_runtime_role;
alter default privileges in schema core grant select, insert, update, delete on tables to cedula_admin_runtime_role;

-- ---------------------------------------------------------------------------
-- Request roles
-- ---------------------------------------------------------------------------
-- The permission groups above document intent. The privileges are also granted
-- directly to the Supabase request roles, because role inheritance is a
-- platform detail (`anon` and `authenticated` are NOINHERIT) and security must
-- not depend on it. Row level security still decides which rows are visible.

-- No grant on `core` for the browser roles: `app` is the only Data API
-- surface, and published knowledge reaches the browser through a server read
-- path rather than through PostgREST.

grant select, insert, update, delete on app.user_cases to authenticated;
-- Read only, deliberately: an evaluation a client could author is not evidence.
grant select on app.case_evaluations to authenticated;

-- Deliberately NOT granted to `authenticated`: app.record_case_evaluation.
-- An evaluation a client could call for is not evidence that the engine
-- produced it. The write runs server-side as the internal runtime role, which
-- passes in the owner it verified; the database checks that owner against the
-- case, so the trust chain ends in the server, never in the browser.
grant execute on function app.erase_user_case(uuid) to authenticated;
