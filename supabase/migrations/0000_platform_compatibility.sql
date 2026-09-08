-- =============================================================================
-- 0000 - Platform compatibility shim
-- =============================================================================
-- On Supabase every object created here already exists and each statement is a
-- no-op. The shim exists so that the migration set can also be applied to a
-- plain PostgreSQL instance (local integration and pgTAP runs), where the
-- Supabase-provided roles and the `auth.uid()` helper are absent.
--
-- It never redefines an object the platform already provides.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit;
  end if;
end
$$;

create schema if not exists auth;

-- `auth.uid()` reads the verified JWT claims the connection was configured
-- with. Supabase installs its own implementation; this fallback matches its
-- contract so that RLS policies are identical in both environments.
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql
      stable
      as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $body$;
    $fn$;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'jwt'
  ) then
    execute $fn$
      create function auth.jwt() returns jsonb
      language sql
      stable
      as $body$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $body$;
    $fn$;
  end if;
end
$$;
