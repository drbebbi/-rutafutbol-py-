-- Roles, grants, RLS enablement and SECURITY DEFINER hardening.
begin;
create extension if not exists pgtap;
select plan(32);

-- Roles exist and hold no dangerous attribute.
select has_role('cedula_runtime_role', 'the normal runtime role exists');
select has_role('cedula_admin_runtime_role', 'the admin runtime role exists');
select is(
  (select count(*)::int from pg_roles
   where rolname in ('cedula_runtime_role', 'cedula_admin_runtime_role')
     and (rolsuper or rolbypassrls or rolcanlogin)),
  0,
  'neither runtime role is SUPERUSER, BYPASSRLS or LOGIN'
);

-- RLS is on everywhere, including tables with no policy at all.
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app', 'core', 'research', 'audit', 'security')
     and c.relkind = 'r'
     and not c.relrowsecurity),
  0,
  'every table in every application schema has row level security enabled'
);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app', 'core', 'research', 'audit', 'security')
     and c.relkind = 'r'
     and not c.relforcerowsecurity),
  0,
  'row level security is forced, so a table owner cannot slip past it'
);

-- app policies.
select policies_are('app', 'user_cases', array[
  'user_cases_select_own', 'user_cases_insert_own', 'user_cases_update_own', 'user_cases_delete_own'
], 'app.user_cases exposes exactly the four owner-scoped policies');

select policies_are('app', 'case_evaluations', array['case_evaluations_select_own'],
  'app.case_evaluations exposes read access only');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'app' and tablename = 'case_evaluations' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'no policy lets a client insert, update or delete an evaluation'
);

-- Anonymous access.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'app' and 'anon' = any(roles)),
  0,
  'anonymous users have no policy on any per-user table'
);

select ok(
  (select count(*) from pg_policies
   where schemaname = 'core' and 'anon' = any(roles) and cmd = 'SELECT') > 0,
  'published knowledge is readable anonymously'
);

-- Grants: the normal runtime cannot write evaluations directly.
select ok(
  not has_table_privilege('cedula_runtime_role', 'app.case_evaluations', 'INSERT'),
  'the normal runtime cannot INSERT an evaluation directly'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'app.case_evaluations', 'UPDATE'),
  'the normal runtime cannot UPDATE an evaluation'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'app.case_evaluations', 'DELETE'),
  'the normal runtime cannot DELETE an evaluation'
);
select ok(
  has_table_privilege('cedula_runtime_role', 'app.case_evaluations', 'SELECT'),
  'the normal runtime may read evaluations'
);
select ok(
  has_table_privilege('cedula_runtime_role', 'core.rule_revisions', 'SELECT'),
  'the normal runtime may read published rules'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'core.rule_revisions', 'INSERT'),
  'the normal runtime may not publish rules'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'research.research_claims', 'SELECT'),
  'the normal runtime cannot read the research pipeline'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'security.admin_authorizations', 'SELECT'),
  'the normal runtime cannot read authorization state'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'security.erasure_journal', 'SELECT'),
  'the normal runtime cannot read the erasure journal'
);
select ok(
  has_table_privilege('cedula_runtime_role', 'audit.evaluation_bundles', 'INSERT'),
  'the normal runtime may materialise an evaluation bundle'
);
select ok(
  not has_table_privilege('cedula_runtime_role', 'audit.admin_audit_events', 'SELECT'),
  'the normal runtime cannot read administrative audit events'
);

-- The admin runtime is powerful over knowledge, not over private cases.
select ok(
  has_table_privilege('cedula_admin_runtime_role', 'core.rule_revisions', 'INSERT'),
  'the admin runtime may write knowledge'
);
select ok(
  not has_table_privilege('cedula_admin_runtime_role', 'app.user_cases', 'SELECT'),
  'the admin runtime cannot browse private user cases by default'
);

-- Schema reachability.
select ok(
  not has_schema_privilege('anon', 'security', 'USAGE'),
  'anonymous users cannot even reach the security schema'
);
select ok(
  not has_schema_privilege('authenticated', 'research', 'USAGE'),
  'authenticated users cannot reach the research schema'
);
select ok(
  not has_schema_privilege('authenticated', 'audit', 'USAGE'),
  'authenticated users cannot reach the audit schema'
);

-- SECURITY DEFINER hardening.
select has_function('security', 'has_admin_role', array['text'], 'the admin role helper exists');
select has_function('app', 'record_case_evaluation', 'the authoritative evaluation write path exists');
select has_function('core', 'publish_rule_revision', 'the publication transaction exists');
select has_function('app', 'erase_user_case', array['uuid'], 'the erasure path exists');

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'core', 'security', 'audit')
     and p.prosecdef
     and coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=""'),
  0,
  'every SECURITY DEFINER function pins an empty search_path'
);

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'core', 'security', 'audit')
     and p.prosecdef
     and has_function_privilege('public', p.oid, 'EXECUTE')),
  0,
  'no SECURITY DEFINER function is executable by PUBLIC'
);

select * from finish();
rollback;
