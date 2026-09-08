-- =============================================================================
-- 0005 - Research pipeline
-- =============================================================================
-- Where a legal claim lives before it is allowed to become a rule. Nothing in
-- `core` may be published without a reviewed claim behind it.
-- =============================================================================

create table research.research_claims (
  id                 uuid primary key default gen_random_uuid(),
  claim_key          core.slug not null unique,
  statement          text not null,
  -- The engine's verification vocabulary, used here as the researcher's
  -- assessment of the evidence.
  assessed_status    core.verification_status not null,
  source_revision_id uuid references core.source_revisions (source_revision_id),
  created_by         uuid not null,
  created_at         timestamptz not null default now()
);

create table research.claim_reviews (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references research.research_claims (id) on delete cascade,
  reviewer_id  uuid not null,
  outcome      text not null check (outcome in ('ACCEPTED', 'REJECTED', 'NEEDS_MORE_EVIDENCE')),
  reviewed_at  timestamptz not null default now()
);

create table research.review_notes (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references research.claim_reviews (id) on delete cascade,
  author_id  uuid not null,
  note       text not null,
  created_at timestamptz not null default now()
);

create table research.research_conflicts (
  id            uuid primary key default gen_random_uuid(),
  conflict_key  core.slug not null unique,
  description   text not null,
  -- A conflict is resolved by evidence, never by preferring one reading.
  status        text not null check (status in ('OPEN', 'RESOLVED', 'OFFICIAL_VERIFICATION_REQUESTED')),
  left_claim_id  uuid references research.research_claims (id),
  right_claim_id uuid references research.research_claims (id),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

comment on table research.research_conflicts is
  'Known contradictions between sources. The temporal Identificaciones document set is one of these.';

create index claim_reviews_claim_idx on research.claim_reviews (claim_id);
create index review_notes_review_idx on research.review_notes (review_id);
create index research_conflicts_status_idx on research.research_conflicts (status);
