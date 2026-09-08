-- =============================================================================
-- 0002 - Published knowledge base
-- =============================================================================
-- Stable identities carry the slug; revisions carry the content and an
-- effective window. The domain treats windows as inclusive on both ends;
-- PostgreSQL normalises them to half-open ranges internally, which is why the
-- exclusion constraints below build `daterange(valid_from, valid_until, '[]')`.
-- =============================================================================

create domain core.slug as text
  check (value ~ '^[a-z0-9]+([-.][a-z0-9]+)*$' and length(value) between 1 and 96);

create domain core.publication_status as text
  check (value in ('DRAFT', 'REVIEWED', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'RETIRED'));

create domain core.verification_status as text
  check (value in ('CONFIRMED', 'STRONG_EVIDENCE', 'CONFLICTING', 'UNKNOWN', 'OFFICIAL_VERIFICATION_REQUIRED'));

create domain core.desired_procedure as text
  check (value in ('FIRST_CEDULA', 'CEDULA_RENEWAL', 'CEDULA_REPLACEMENT'));

create domain core.country_code as text check (value ~ '^[A-Z]{2}$');
create domain core.currency_code as text check (value ~ '^[A-Z]{3}$');
create domain core.language_code as text check (value ~ '^[a-z]{2}$');
create domain core.schema_version as text check (value ~ '^[a-z][a-z0-9-]*@[0-9]+\.[0-9]+$');
create domain core.sha256_hex as text check (value ~ '^[0-9a-f]{64}$');

create table core.countries (
  country_code core.country_code primary key,
  label        text not null
);

create table core.authorities (
  authority_id core.slug primary key,
  country_code core.country_code not null references core.countries (country_code),
  label        text not null
);

create table core.offices (
  office_id    core.slug primary key,
  authority_id core.slug not null references core.authorities (authority_id)
);

create table core.office_revisions (
  office_revision_id uuid primary key default gen_random_uuid(),
  office_id          core.slug not null references core.offices (office_id),
  publication_status core.publication_status not null,
  valid_from         date not null,
  valid_until        date,
  label              text not null,
  city               text,
  constraint office_revisions_window_ordered check (valid_until is null or valid_until >= valid_from)
);

create table core.procedures (
  procedure_id core.slug primary key,
  authority_id core.slug not null references core.authorities (authority_id),
  label        text not null
);

create table core.document_types (
  document_type_id core.slug primary key,
  label            text not null
);

create table core.sources (
  source_id    core.slug primary key,
  authority_id core.slug not null references core.authorities (authority_id),
  kind         text not null check (kind in ('LAW', 'DECREE', 'RESOLUTION', 'OFFICIAL_WEBSITE', 'OFFICIAL_FORM', 'OFFICIAL_FEE_SCHEDULE')),
  citation     text not null
);

create table core.source_revisions (
  source_revision_id uuid primary key default gen_random_uuid(),
  source_id          core.slug not null references core.sources (source_id),
  publication_status core.publication_status not null,
  language           core.language_code not null,
  -- Nullable on purpose: many official pages carry no publication date, and
  -- inventing one would turn a gap in the source into a usable fact.
  published_at       date,
  retrieved_at       timestamptz not null,
  -- When the wording applies, as opposed to when it was fetched.
  effective_from     date,
  effective_until    date,
  supersedes         uuid references core.source_revisions (source_revision_id),
  confidence         text not null default 'MEDIUM'
                       check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  notes              text,
  locator            text not null,
  constraint source_revisions_window_ordered check (
    effective_until is null or effective_from is null or effective_until >= effective_from
  ),
  constraint source_revisions_not_self_superseding check (supersedes is null or supersedes <> source_revision_id)
);

create table core.rule_sets (
  rule_set_id core.slug primary key,
  label       text not null
);

create table core.rule_set_revisions (
  rule_set_revision_id uuid primary key default gen_random_uuid(),
  rule_set_id          core.slug not null references core.rule_sets (rule_set_id),
  publication_status   core.publication_status not null,
  valid_from           date not null,
  valid_until          date,
  constraint rule_set_revisions_window_ordered check (valid_until is null or valid_until >= valid_from)
);

create table core.rules (
  rule_id     core.slug primary key,
  rule_set_id core.slug not null references core.rule_sets (rule_set_id),
  label       text not null
);

create table core.rule_revisions (
  rule_revision_id      uuid primary key default gen_random_uuid(),
  rule_id               core.slug not null references core.rules (rule_id),
  rule_set_revision_id  uuid not null references core.rule_set_revisions (rule_set_revision_id),
  version               integer not null check (version >= 1),
  publication_status    core.publication_status not null,
  verification_status   core.verification_status not null,
  valid_from            date not null,
  valid_until           date,
  payload_schema_version core.schema_version not null,
  -- The payload is DATA. It is interpreted by the engine's closed AST
  -- evaluator; it is never executed, never eval()'d, never compiled.
  --
  -- Precedence and the resolution (consequence or verification request) live
  -- inside the payload, because they are part of what the rule *says* and are
  -- covered by the payload schema version and the bundle hash along with it.
  payload               jsonb not null,
  created_at            timestamptz not null default now(),
  constraint rule_revisions_window_ordered check (valid_until is null or valid_until >= valid_from),
  constraint rule_revisions_unique_version unique (rule_id, version),
  -- A rule either states a consequence or asks for verification, and which of
  -- the two it does has to agree with its evidence status. Enforced here as
  -- well as in the validator: a hand-edited row must not be able to give a
  -- CONFLICTING rule a consequence.
  constraint rule_revisions_resolution_shape check (
    payload -> 'resolution' ->> 'state' in ('RESOLVED', 'UNRESOLVED')
  ),
  constraint rule_revisions_resolution_matches_status check (
    (verification_status in ('CONFIRMED', 'STRONG_EVIDENCE')
       and payload -> 'resolution' ->> 'state' = 'RESOLVED')
    or (verification_status in ('CONFLICTING', 'UNKNOWN', 'OFFICIAL_VERIFICATION_REQUIRED')
       and payload -> 'resolution' ->> 'state' = 'UNRESOLVED'
       and payload -> 'resolution' ->> 'reason' = verification_status::text)
  ),
  constraint rule_revisions_precedence_is_array check (
    jsonb_typeof(payload -> 'precedence') = 'array'
  )
);

comment on column core.rule_revisions.payload is
  'Rule condition and consequence as data. Never executable code.';

create table core.rule_evidence (
  rule_revision_id   uuid not null references core.rule_revisions (rule_revision_id) on delete cascade,
  source_revision_id uuid not null references core.source_revisions (source_revision_id),
  -- A contradicting source is evidence too: it is the reason a rule is
  -- CONFLICTING, and dropping it would erase why.
  role               text not null default 'SUPPORTS'
                       check (role in ('SUPPORTS', 'CONTRADICTS', 'CONTEXT')),
  claim_summary      text not null,
  citation_detail    text not null,
  quote              text,
  primary key (rule_revision_id, source_revision_id, citation_detail)
);

create table core.fee_indexes (
  fee_index_id core.slug primary key,
  label        text not null
);

create table core.fee_index_revisions (
  fee_index_revision_id uuid primary key default gen_random_uuid(),
  fee_index_id          core.slug not null references core.fee_indexes (fee_index_id),
  publication_status    core.publication_status not null,
  verification_status   core.verification_status not null,
  valid_from            date not null,
  valid_until           date,
  unit_amount_minor     bigint not null check (unit_amount_minor >= 0),
  unit_currency         core.currency_code not null,
  constraint fee_index_revisions_window_ordered check (valid_until is null or valid_until >= valid_from)
);

create table core.fee_index_revision_sources (
  fee_index_revision_id uuid not null references core.fee_index_revisions (fee_index_revision_id) on delete cascade,
  source_revision_id    uuid not null references core.source_revisions (source_revision_id),
  primary key (fee_index_revision_id, source_revision_id)
);

create table core.product_policies (
  product_policy_id core.slug primary key,
  label             text not null
);

create table core.product_policy_revisions (
  product_policy_revision_id uuid primary key default gen_random_uuid(),
  product_policy_id          core.slug not null references core.product_policies (product_policy_id),
  publication_status         core.publication_status not null,
  valid_from                 date not null,
  valid_until                date,
  payload_schema_version     core.schema_version not null,
  -- Product scope and the closed set of effects it may produce, as data.
  -- A ProductPolicy may decline to serve a case, ask for research, ask the
  -- applicant a question or warn. It may never add a procedure, a document, a
  -- formality or a fee, and the payload has no shape in which it could.
  payload                    jsonb not null,
  constraint product_policy_revisions_window_ordered check (valid_until is null or valid_until >= valid_from),
  constraint product_policy_revisions_payload_shape check (
    jsonb_typeof(payload -> 'supportedDesiredProcedures') = 'array'
    and jsonb_typeof(payload -> 'rules') = 'array'
  )
);

create table core.product_coverages (
  product_coverage_id core.slug primary key,
  label               text not null
);

create table core.product_coverage_revisions (
  product_coverage_revision_id uuid primary key default gen_random_uuid(),
  product_coverage_id          core.slug not null references core.product_coverages (product_coverage_id),
  publication_status           core.publication_status not null,
  valid_from                   date not null,
  valid_until                  date,
  country_code                 core.country_code not null,
  desired_procedure            core.desired_procedure not null,
  state                        text not null check (state in ('SUPPORTED', 'PARTIAL', 'NOT_SUPPORTED', 'RESEARCH_REQUIRED')),
  constraint product_coverage_revisions_window_ordered check (valid_until is null or valid_until >= valid_from)
);

create table core.pathway_definitions (
  pathway_definition_id core.slug primary key,
  pathway_id            core.slug not null,
  label                 text not null
);

create table core.pathway_definition_revisions (
  pathway_definition_revision_id uuid primary key default gen_random_uuid(),
  pathway_definition_id          core.slug not null references core.pathway_definitions (pathway_definition_id),
  publication_status             core.publication_status not null,
  valid_from                     date not null,
  valid_until                    date,
  payload_schema_version         core.schema_version not null,
  -- Presentation only: which sections exist and how procedures are grouped.
  payload                        jsonb not null,
  constraint pathway_definition_revisions_window_ordered check (valid_until is null or valid_until >= valid_from),
  constraint pathway_definition_revisions_payload_shape check (
    jsonb_typeof(payload -> 'appliesToCaseTypes') = 'array'
    and jsonb_typeof(payload -> 'sections') = 'array'
  )
);

-- ---------------------------------------------------------------------------
-- Effective window exclusion constraints
-- ---------------------------------------------------------------------------
-- For one stable identity, two revisions that are both live knowledge
-- (PUBLISHED or SUPERSEDED) may never cover the same day: an evaluation dated
-- inside an overlap would have no defensible answer.

alter table core.rule_revisions
  add constraint rule_revisions_no_overlap
  exclude using gist (
    rule_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

alter table core.rule_set_revisions
  add constraint rule_set_revisions_no_overlap
  exclude using gist (
    rule_set_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

alter table core.fee_index_revisions
  add constraint fee_index_revisions_no_overlap
  exclude using gist (
    fee_index_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

alter table core.product_policy_revisions
  add constraint product_policy_revisions_no_overlap
  exclude using gist (
    product_policy_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

alter table core.product_coverage_revisions
  add constraint product_coverage_revisions_no_overlap
  exclude using gist (
    product_coverage_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

alter table core.pathway_definition_revisions
  add constraint pathway_definition_revisions_no_overlap
  exclude using gist (
    pathway_definition_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

alter table core.office_revisions
  add constraint office_revisions_no_overlap
  exclude using gist (
    office_id with =,
    daterange(valid_from, valid_until, '[]') with &&
  ) where (publication_status in ('PUBLISHED', 'SUPERSEDED'));

create index rule_revisions_lookup_idx
  on core.rule_revisions (rule_id, publication_status, valid_from);
create index rule_revisions_rule_set_idx on core.rule_revisions (rule_set_revision_id);
create index fee_index_revisions_lookup_idx
  on core.fee_index_revisions (fee_index_id, publication_status, valid_from);
create index product_coverage_lookup_idx
  on core.product_coverage_revisions (country_code, desired_procedure, publication_status);
create index rule_evidence_source_idx on core.rule_evidence (source_revision_id);
