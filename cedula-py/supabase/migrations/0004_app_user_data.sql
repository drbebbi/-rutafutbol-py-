-- =============================================================================
-- 0004 - Per-user data
-- =============================================================================

create table app.user_cases (
  id                   uuid primary key default gen_random_uuid(),
  owner_user_id        uuid not null,
  facts_schema_version core.schema_version not null,
  -- PERSONAL_HIGH_RISK. Residence history, special-case answers and migration
  -- context live in here; it is never logged and never sent to analytics.
  facts_jsonb          jsonb not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Lets `app.case_evaluations` carry a composite foreign key, so an
  -- evaluation can never be attached to a case owned by someone else.
  constraint user_cases_owner_identity unique (id, owner_user_id)
);

comment on table app.user_cases is 'PERSONAL_HIGH_RISK. One wizard case per row.';

create index user_cases_owner_idx on app.user_cases (owner_user_id, updated_at desc);

-- Ownership is immutable: transferring a case would move personal data between
-- subjects without either of them asking.
create function app.forbid_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'user case ownership is immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_cases_owner_immutable
  before update on app.user_cases
  for each row execute function app.forbid_owner_change();

create table app.case_evaluations (
  id                       uuid primary key default gen_random_uuid(),
  owner_user_id            uuid not null,
  user_case_id             uuid not null,
  evaluated_at             timestamptz not null,
  jurisdiction_time_zone   text not null,
  -- The legal cut-off date actually used. Persisted because re-deriving it
  -- later from evaluated_at would depend on a tz database that may have moved.
  effective_local_date     date not null,
  engine_version           text not null,
  input_schema_version     core.schema_version not null,
  input_hash               core.sha256_hex not null,
  -- PERSONAL_HIGH_RISK: the complete evaluation input.
  input_snapshot_jsonb     jsonb not null,
  evaluation_bundle_id     uuid not null references audit.evaluation_bundles (id),
  evaluation_schema_version core.schema_version not null,
  decision_jsonb           jsonb not null,
  created_at               timestamptz not null default now(),
  constraint case_evaluations_owner_matches_case
    foreign key (user_case_id, owner_user_id)
    references app.user_cases (id, owner_user_id)
    on delete cascade
);

comment on table app.case_evaluations is
  'PERSONAL_HIGH_RISK, append-only. Written only through app.record_case_evaluation.';

create index case_evaluations_case_idx on app.case_evaluations (user_case_id, created_at desc);
create index case_evaluations_owner_idx on app.case_evaluations (owner_user_id, created_at desc);

-- Append-only in the strongest sense available: even a role that somehow held
-- UPDATE or DELETE cannot rewrite history here. Erasure goes through the
-- dedicated, audited path in migration 0006.
create function app.forbid_evaluation_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'app.case_evaluations is append-only';
end;
$$;

create trigger case_evaluations_no_update
  before update on app.case_evaluations
  for each row execute function app.forbid_evaluation_mutation();
