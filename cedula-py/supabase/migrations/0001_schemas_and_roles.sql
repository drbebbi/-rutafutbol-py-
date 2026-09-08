-- =============================================================================
-- 0001 - Schemas, runtime roles and baseline privileges
-- =============================================================================
-- Five schemas, each with one job:
--   app      - the only Data API surface; per-user data.
--   core     - published knowledge (rules, sources, fees, coverage, pathways).
--   research - the editorial pipeline behind that knowledge.
--   audit    - immutable evidence of what was evaluated and what was published.
--   security - authorization state and erasure records.
--
-- Nothing belonging to Cedula PY is created in `public`. An accidental grant on
-- `public` must not be able to expose a single row of user data.
-- =============================================================================

create schema if not exists app;
create schema if not exists core;
create schema if not exists research;
create schema if not exists audit;
create schema if not exists security;

comment on schema app is 'Cedula PY: per-user data. The only Data API surface.';
comment on schema core is 'Cedula PY: published knowledge base.';
comment on schema research is 'Cedula PY: editorial research pipeline.';
comment on schema audit is 'Cedula PY: immutable audit and evaluation bundles.';
comment on schema security is 'Cedula PY: authorization and erasure records.';

-- Harden `public`: no new objects, no default access.
revoke create on schema public from public;
revoke all on schema public from anon, authenticated;

-- Permission groups. NOLOGIN, and deliberately neither SUPERUSER nor BYPASSRLS:
-- row level security must constrain the runtime, not be waved past by it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cedula_runtime_role') then
    create role cedula_runtime_role nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'cedula_admin_runtime_role') then
    create role cedula_admin_runtime_role nologin noinherit;
  end if;
end
$$;

comment on role cedula_runtime_role is
  'Normal application runtime: reads published knowledge, materialises evaluation bundles, writes evaluations through the authorized server path.';
comment on role cedula_admin_runtime_role is
  'Admin runtime: research and publication. Does not browse private user cases by default.';

-- No schema is reachable by default; every grant below is explicit.
revoke all on schema app, core, research, audit, security from public;

grant usage on schema app to cedula_runtime_role, cedula_admin_runtime_role, anon, authenticated;
grant usage on schema core to cedula_runtime_role, cedula_admin_runtime_role, anon, authenticated;
grant usage on schema audit to cedula_runtime_role, cedula_admin_runtime_role;
grant usage on schema research to cedula_admin_runtime_role;
grant usage on schema security to cedula_admin_runtime_role;

-- The Supabase request roles inherit the runtime permission groups; RLS still
-- decides which rows they may actually see.
grant cedula_runtime_role to authenticated;
grant cedula_runtime_role to anon;
