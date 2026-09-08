-- Constraints: checks, exclusions, immutability, append-only.
begin;
create extension if not exists pgtap;
select plan(16);

select has_check('core', 'rule_revisions', 'core.rule_revisions carries check constraints');

-- Effective windows may not be inverted.
select throws_ok(
  $$ insert into core.rule_sets (rule_set_id, label) values ('t.set', 'x');
     insert into core.rule_set_revisions (rule_set_id, publication_status, valid_from, valid_until)
     values ('t.set', 'PUBLISHED', '2026-05-01', '2026-01-01') $$,
  '23514',
  null,
  'an inverted effective window is rejected'
);

-- Exclusion constraint: two live revisions of one rule may not overlap.
insert into core.countries (country_code, label) values ('ZZ', 'Test') on conflict do nothing;
insert into core.authorities (authority_id, country_code, label) values ('t.authority', 'ZZ', 'Test');
insert into core.rule_sets (rule_set_id, label) values ('t.set', 'Test');
insert into core.rule_set_revisions (rule_set_revision_id, rule_set_id, publication_status, valid_from, valid_until)
values ('11111111-1111-4111-8111-111111111111', 't.set', 'PUBLISHED', '2000-01-01', null);
insert into core.rules (rule_id, rule_set_id, label) values ('t.rule', 't.set', 'Test');

insert into core.rule_revisions (
  rule_revision_id, rule_id, rule_set_revision_id, version, publication_status,
  verification_status, valid_from, valid_until, payload_schema_version, payload
) values (
  '22222222-2222-4222-8222-222222222222', 't.rule', '11111111-1111-4111-8111-111111111111',
  1, 'PUBLISHED', 'CONFIRMED', '2026-01-01', '2026-06-30', 'rule-payload@2.0', '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"RESOLVED","consequence":{"code":"FEE_MAY_CHANGE","severity":"INFO","qualifier":null}}}'::jsonb
);

select lives_ok(
  $$ insert into core.rule_revisions (
       rule_id, rule_set_revision_id, version, publication_status, verification_status,
       valid_from, valid_until, payload_schema_version, payload
     ) values ('t.rule', '11111111-1111-4111-8111-111111111111', 2, 'PUBLISHED', 'CONFIRMED',
               '2026-07-01', null, 'rule-payload@2.0', '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"RESOLVED","consequence":{"code":"FEE_MAY_CHANGE","severity":"INFO","qualifier":null}}}'::jsonb) $$,
  'an adjacent, non-overlapping revision is accepted'
);

select throws_ok(
  $$ insert into core.rule_revisions (
       rule_id, rule_set_revision_id, version, publication_status, verification_status,
       valid_from, valid_until, payload_schema_version, payload
     ) values ('t.rule', '11111111-1111-4111-8111-111111111111', 3, 'PUBLISHED', 'CONFIRMED',
               '2026-06-01', '2026-08-01', 'rule-payload@2.0', '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"RESOLVED","consequence":{"code":"FEE_MAY_CHANGE","severity":"INFO","qualifier":null}}}'::jsonb) $$,
  '23P01',
  null,
  'an overlapping live revision of the same rule is rejected by the exclusion constraint'
);

select lives_ok(
  $$ insert into core.rule_revisions (
       rule_id, rule_set_revision_id, version, publication_status, verification_status,
       valid_from, valid_until, payload_schema_version, payload
     ) values ('t.rule', '11111111-1111-4111-8111-111111111111', 4, 'DRAFT', 'CONFIRMED',
               '2026-06-01', '2026-08-01', 'rule-payload@2.0', '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"RESOLVED","consequence":{"code":"FEE_MAY_CHANGE","severity":"INFO","qualifier":null}}}'::jsonb) $$,
  'a draft revision may overlap, because it is not live knowledge'
);

-- A rule with conflicting evidence must not carry a consequence.
select throws_ok(
  $$ insert into core.rule_revisions (
       rule_id, rule_set_revision_id, version, publication_status, verification_status,
       valid_from, payload_schema_version, payload
     ) values ('t.rule', '11111111-1111-4111-8111-111111111111', 5, 'DRAFT', 'CONFLICTING',
               '2030-01-01', 'rule-payload@2.0', '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"RESOLVED","consequence":{"code":"FEE_MAY_CHANGE","severity":"INFO","qualifier":null}}}'::jsonb) $$,
  '23514',
  null,
  'a rule with conflicting evidence that still states a consequence is rejected'
);

-- ...and the reason it gives must be the evidence status it carries.
select throws_ok(
  $$ insert into core.rule_revisions (
       rule_id, rule_set_revision_id, version, publication_status, verification_status,
       valid_from, payload_schema_version, payload
     ) values ('t.rule', '11111111-1111-4111-8111-111111111111', 6, 'DRAFT', 'CONFLICTING',
               '2031-01-01', 'rule-payload@2.0',
               '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"UNRESOLVED","reason":"UNKNOWN","verification":{"code":"FEE_AMOUNT_UNCONFIRMED","target":{"kind":"CASE"}}}}'::jsonb) $$,
  '23514',
  null,
  'an unresolved rule whose reason contradicts its evidence status is rejected'
);

select lives_ok(
  $$ insert into core.rule_revisions (
       rule_id, rule_set_revision_id, version, publication_status, verification_status,
       valid_from, payload_schema_version, payload
     ) values ('t.rule', '11111111-1111-4111-8111-111111111111', 7, 'DRAFT', 'CONFLICTING',
               '2032-01-01', 'rule-payload@2.0',
               '{"family":"WARNING","scope":"CASE","condition":{"kind":"CONSTANT","value":"TRUE"},"precedence":[],"resolution":{"state":"UNRESOLVED","reason":"CONFLICTING","verification":{"code":"FEE_AMOUNT_UNCONFIRMED","target":{"kind":"CASE"}}}}'::jsonb) $$,
  'an unresolved rule whose reason matches its evidence status is accepted'
);

-- Domain checks.
select throws_ok(
  $$ insert into core.countries (country_code, label) values ('deu', 'x') $$,
  '23514', null, 'a malformed country code is rejected'
);
select throws_ok(
  $$ insert into audit.evaluation_bundles (content_hash, schema_version, bundle_content_jsonb)
     values ('NOTAHASH', 'evaluation-bundle@1.0', '{}'::jsonb) $$,
  '23514', null, 'a malformed content hash is rejected'
);
select throws_ok(
  $$ insert into core.rule_sets (rule_set_id, label) values ('Not A Slug', 'x') $$,
  '23514', null, 'a malformed slug is rejected'
);

-- Bundle content hash is unique.
insert into audit.evaluation_bundles (content_hash, schema_version, bundle_content_jsonb)
values (repeat('a', 64), 'evaluation-bundle@1.0', '{"a":1}'::jsonb);
select throws_ok(
  format($$ insert into audit.evaluation_bundles (content_hash, schema_version, bundle_content_jsonb)
            values (%L, 'evaluation-bundle@1.0', '{"a":2}'::jsonb) $$, repeat('a', 64)),
  '23505', null, 'the same content hash cannot be stored twice'
);

-- User case ownership is immutable, and evaluations are append-only.
insert into app.user_cases (id, owner_user_id, facts_schema_version, facts_jsonb)
values ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
        'user-case-facts@1.0', '{}'::jsonb);

select throws_ok(
  $$ update app.user_cases set owner_user_id = '55555555-5555-4555-8555-555555555555'
     where id = '33333333-3333-4333-8333-333333333333' $$,
  'P0001', 'user case ownership is immutable',
  'a user case cannot be transferred to another owner'
);

select lives_ok(
  $$ update app.user_cases set facts_jsonb = '{"a":1}'::jsonb
     where id = '33333333-3333-4333-8333-333333333333' $$,
  'a user may still correct their own facts'
);

insert into app.case_evaluations (
  id, owner_user_id, user_case_id, evaluated_at, jurisdiction_time_zone, effective_local_date,
  engine_version, input_schema_version, input_hash, input_snapshot_jsonb,
  evaluation_bundle_id, evaluation_schema_version, decision_jsonb
) values (
  '66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444',
  '33333333-3333-4333-8333-333333333333', now(), 'America/Asuncion', current_date,
  '1.0.0', 'user-case-facts@1.0', repeat('b', 64), '{}'::jsonb,
  (select id from audit.evaluation_bundles limit 1), 'case-evaluation-decision@1.0', '{}'::jsonb
);

select throws_ok(
  $$ update app.case_evaluations set decision_jsonb = '{"tampered":true}'::jsonb $$,
  'P0001', 'app.case_evaluations is append-only',
  'a stored evaluation cannot be rewritten'
);

-- An evaluation may not claim a case owned by somebody else.
select throws_ok(
  $$ insert into app.case_evaluations (
       owner_user_id, user_case_id, evaluated_at, jurisdiction_time_zone, effective_local_date,
       engine_version, input_schema_version, input_hash, input_snapshot_jsonb,
       evaluation_bundle_id, evaluation_schema_version, decision_jsonb
     ) values (
       '77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333',
       now(), 'America/Asuncion', current_date, '1.0.0', 'user-case-facts@1.0', repeat('c', 64),
       '{}'::jsonb, (select id from audit.evaluation_bundles limit 1),
       'case-evaluation-decision@1.0', '{}'::jsonb
     ) $$,
  '23503', null,
  'an evaluation cannot be attached to a case owned by another user'
);

select * from finish();
rollback;
