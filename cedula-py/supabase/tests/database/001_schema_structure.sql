-- Structure: schemas, tables, columns, keys.
begin;
create extension if not exists pgtap;
select plan(52);

select has_schema('app'), 'schema app exists';
select has_schema('core'), 'schema core exists';
select has_schema('research'), 'schema research exists';
select has_schema('audit'), 'schema audit exists';
select has_schema('security'), 'schema security exists';

-- No Cedula PY table may live in `public`: an accidental grant there must not
-- be able to expose anything.
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' $$,
  'public schema holds no application tables'
);

select has_table('app', 'user_cases', 'app.user_cases exists');
select has_table('app', 'case_evaluations', 'app.case_evaluations exists');
select has_table('audit', 'evaluation_bundles', 'audit.evaluation_bundles exists');
select has_table('audit', 'admin_audit_events', 'audit.admin_audit_events exists');
select has_table('security', 'admin_authorizations', 'security.admin_authorizations exists');
select has_table('security', 'erasure_journal', 'security.erasure_journal exists');
select has_table('research', 'research_claims', 'research.research_claims exists');
select has_table('research', 'claim_reviews', 'research.claim_reviews exists');
select has_table('research', 'review_notes', 'research.review_notes exists');
select has_table('research', 'research_conflicts', 'research.research_conflicts exists');

select has_table('core', t, format('core.%s exists', t))
from unnest(array[
  'countries', 'authorities', 'offices', 'office_revisions', 'procedures',
  'document_types', 'sources', 'source_revisions', 'rule_sets',
  'rule_set_revisions', 'rules', 'rule_revisions', 'rule_evidence',
  'fee_indexes', 'fee_index_revisions', 'fee_index_revision_sources',
  'product_policies', 'product_policy_revisions', 'product_coverages',
  'product_coverage_revisions', 'pathway_definitions', 'pathway_definition_revisions'
]) as t;

select has_column('app', 'case_evaluations', 'effective_local_date',
  'the legal cut-off date actually used is persisted');
select col_not_null('app', 'case_evaluations', 'effective_local_date',
  'effective_local_date is mandatory');
select has_column('app', 'case_evaluations', 'input_hash', 'the input hash is persisted');
select has_column('app', 'case_evaluations', 'input_snapshot_jsonb', 'the input snapshot is persisted');
select has_column('app', 'case_evaluations', 'evaluation_bundle_id', 'the bundle is referenced');
select has_column('app', 'user_cases', 'facts_schema_version', 'the facts schema version is persisted');

select has_pk('app', 'user_cases', 'app.user_cases has a primary key');
select has_pk('app', 'case_evaluations', 'app.case_evaluations has a primary key');
select has_pk('core', 'rule_revisions', 'core.rule_revisions has a primary key');

-- Composite integrity: an evaluation cannot be attached to someone else's case.
select col_is_unique('app', 'user_cases', array['id', 'owner_user_id'],
  'user case identity carries its owner');
select has_fk('app', 'case_evaluations', 'app.case_evaluations has a foreign key');
select fk_ok('app', 'case_evaluations', array['user_case_id', 'owner_user_id'],
             'app', 'user_cases', array['id', 'owner_user_id'],
  'evaluation ownership is enforced by a composite foreign key');

select has_index('core', 'rule_revisions', 'rule_revisions_lookup_idx', 'rule lookup index exists');
select has_index('app', 'case_evaluations', 'case_evaluations_case_idx', 'evaluation lookup index exists');

select * from finish();
rollback;
