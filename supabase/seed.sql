-- =============================================================================
-- Local seed data
-- =============================================================================
-- DELIBERATELY CONTAINS NO LEGAL RULES.
--
-- Seeding a rule would mean asserting a legal requirement, and the approved
-- research baseline is not yet complete enough to author production rules
-- from. What is seeded here is neutral reference data plus the record of the
-- open research conflict, so that the conflict is visible in every environment
-- rather than living only in a document.
--
-- Synthetic rules used by the test suites live in `tests/`, never here: a seed
-- must never be able to cause an accidental production rule publication.
-- =============================================================================

insert into core.countries (country_code, label) values
  ('PY', 'Paraguay'),
  ('AT', 'Austria'),
  ('BE', 'Belgium'),
  ('CH', 'Switzerland'),
  ('DE', 'Germany'),
  ('ES', 'Spain'),
  ('FR', 'France'),
  ('GB', 'United Kingdom'),
  ('IT', 'Italy'),
  ('NL', 'Netherlands'),
  ('PT', 'Portugal')
on conflict (country_code) do nothing;

-- The open research conflict, recorded as data.
--
-- Established: Residencia Temporal (Ley 6984/2022) can in principle open the
-- way to a first cedula. Not established: the exact document set the
-- Identificaciones service requires from a temporal resident. The published
-- page is titled for temporal and permanent residents, yet its document list
-- names permanent-residence documents (Certificado de Radicacion Permanente,
-- Carnet de Admision Permanente). The conflict is recorded, not resolved.
insert into research.research_conflicts (conflict_key, description, status)
values (
  'temporal-identificaciones-document-set',
  'The Identificaciones publication covering first cedula issuance is titled for temporal and permanent residents, but its published document list names permanent-residence documents. The exact temporal document set under Resolucion 717/26 is therefore CONFLICTING and requires official verification. It must not be resolved by substituting PERMANENTE with TEMPORAL.',
  'OFFICIAL_VERIFICATION_REQUESTED'
)
on conflict (conflict_key) do nothing;
