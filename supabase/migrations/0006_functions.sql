-- =============================================================================
-- 0006 - Authorized server paths
-- =============================================================================
-- Every function here is SECURITY DEFINER and therefore hardened the same way:
--   * `set search_path = ''`
--   * every object reference fully schema-qualified
--   * EXECUTE revoked from PUBLIC, granted explicitly
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Evaluation bundle materialisation
-- ---------------------------------------------------------------------------
-- Same canonical content -> same hash -> the existing row is reused. If a row
-- with this hash exists but holds different content, that is a hash collision
-- or a canonicalisation bug; either way it is an invariant failure, not
-- something to overwrite.
create function audit.materialize_evaluation_bundle(
  p_content_hash core.sha256_hex,
  p_schema_version core.schema_version,
  p_bundle_content jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing jsonb;
begin
  select b.id, b.bundle_content_jsonb
    into v_id, v_existing
  from audit.evaluation_bundles b
  where b.content_hash = p_content_hash;

  if found then
    if v_existing is distinct from p_bundle_content then
      raise exception 'INVARIANT FAILURE: bundle % already exists with different content', p_content_hash;
    end if;
    return v_id;
  end if;

  insert into audit.evaluation_bundles (content_hash, schema_version, bundle_content_jsonb)
  values (p_content_hash, p_schema_version, p_bundle_content)
  on conflict (content_hash) do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a race with a concurrent materialisation of identical content.
    select b.id into v_id from audit.evaluation_bundles b where b.content_hash = p_content_hash;
  end if;

  return v_id;
end;
$$;

revoke all on function audit.materialize_evaluation_bundle(core.sha256_hex, core.schema_version, jsonb) from public;
grant execute on function audit.materialize_evaluation_bundle(core.sha256_hex, core.schema_version, jsonb)
  to cedula_runtime_role, cedula_admin_runtime_role;

-- ---------------------------------------------------------------------------
-- Authoritative evaluation write
-- ---------------------------------------------------------------------------
-- Users may read their evaluations but never insert one: a decision the user
-- could author is not evidence of anything.
-- The authoritative evaluation writer.
--
-- Callable only by the internal runtime roles. The browser roles hold no
-- EXECUTE privilege on it at all, so a client cannot fabricate a decision and
-- have it stored as if the engine produced it - not even one about its own
-- case. The owner is passed in by the server from a verified identity and is
-- checked against the case here, so a wrong value is rejected rather than
-- believed.
create function app.record_case_evaluation(
  p_owner_user_id uuid,
  p_user_case_id uuid,
  p_evaluated_at timestamptz,
  p_jurisdiction_time_zone text,
  p_effective_local_date date,
  p_engine_version text,
  p_input_schema_version core.schema_version,
  p_input_hash core.sha256_hex,
  p_input_snapshot jsonb,
  p_evaluation_bundle_id uuid,
  p_evaluation_schema_version core.schema_version,
  p_decision jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  select c.owner_user_id into v_owner
  from app.user_cases c
  where c.id = p_user_case_id;

  if v_owner is null then
    raise exception 'user case not found';
  end if;

  if p_owner_user_id is null or v_owner <> p_owner_user_id then
    raise exception 'not authorized to record an evaluation for this case';
  end if;

  insert into app.case_evaluations (
    owner_user_id, user_case_id, evaluated_at, jurisdiction_time_zone, effective_local_date,
    engine_version, input_schema_version, input_hash, input_snapshot_jsonb,
    evaluation_bundle_id, evaluation_schema_version, decision_jsonb
  ) values (
    v_owner, p_user_case_id, p_evaluated_at, p_jurisdiction_time_zone, p_effective_local_date,
    p_engine_version, p_input_schema_version, p_input_hash, p_input_snapshot,
    p_evaluation_bundle_id, p_evaluation_schema_version, p_decision
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function app.record_case_evaluation(uuid, uuid, timestamptz, text, date, text, core.schema_version, core.sha256_hex, jsonb, uuid, core.schema_version, jsonb) from public;
grant execute on function app.record_case_evaluation(uuid, uuid, timestamptz, text, date, text, core.schema_version, core.sha256_hex, jsonb, uuid, core.schema_version, jsonb)
  to cedula_runtime_role, cedula_admin_runtime_role;

-- ---------------------------------------------------------------------------
-- Erasure
-- ---------------------------------------------------------------------------
-- Deleting a case removes the case and its evaluations. It never removes the
-- evaluation bundle, rule revision, source revision, fee index revision or
-- product policy revision those evaluations referenced: that is shared,
-- non-personal knowledge, and destroying it would make every other user's
-- stored evaluation unexplainable.
create function app.erase_user_case(p_user_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select c.owner_user_id into v_owner from app.user_cases c where c.id = p_user_case_id;

  if v_owner is null then
    raise exception 'user case not found';
  end if;
  if auth.uid() is null or v_owner <> auth.uid() then
    raise exception 'not authorized to erase this case';
  end if;

  delete from app.user_cases where id = p_user_case_id;

  insert into security.erasure_journal (deleted_subject_id, operation_status, scope)
  values (v_owner, 'COMPLETED', 'CASE');
end;
$$;

revoke all on function app.erase_user_case(uuid) from public;
grant execute on function app.erase_user_case(uuid) to cedula_runtime_role, cedula_admin_runtime_role;

-- ---------------------------------------------------------------------------
-- Publication transaction
-- ---------------------------------------------------------------------------
-- The whole publication is one transaction: lock the stable identity, close the
-- predecessor's open window, publish the successor, write the audit event.
-- The lock is taken on the row, not as a session advisory lock, so it is
-- released with the transaction and survives connection pooling.
create function core.publish_rule_revision(
  p_rule_revision_id uuid,
  p_valid_from date,
  p_approved_candidate_hash core.sha256_hex,
  p_actual_candidate_hash core.sha256_hex
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_id core.slug;
  v_status core.publication_status;
  v_predecessor uuid;
begin
  if not security.has_admin_role('PUBLISHER') and not security.has_admin_role('ADMIN') then
    raise exception 'not authorized to publish rules';
  end if;

  -- Publication approval is bound to the exact validated candidate. If the
  -- candidate moved since it was approved, publishing would ship something
  -- nobody validated.
  if p_approved_candidate_hash is distinct from p_actual_candidate_hash then
    raise exception 'STALE_PUBLICATION_VALIDATION: approved % but candidate is now %',
      p_approved_candidate_hash, p_actual_candidate_hash;
  end if;

  select r.rule_id, r.publication_status into v_rule_id, v_status
  from core.rule_revisions r
  where r.rule_revision_id = p_rule_revision_id
  for update;

  if v_rule_id is null then
    raise exception 'rule revision not found';
  end if;
  if v_status <> 'APPROVED' then
    raise exception 'only an APPROVED revision can be published, this one is %', v_status;
  end if;

  -- Lock the stable identity so two publishers cannot both close the same
  -- predecessor.
  perform 1 from core.rules where rule_id = v_rule_id for update;

  select r.rule_revision_id into v_predecessor
  from core.rule_revisions r
  where r.rule_id = v_rule_id
    and r.publication_status = 'PUBLISHED'
    and r.valid_until is null
  for update;

  if v_predecessor is not null then
    -- The one controlled lifecycle exception to revision immutability:
    -- an open-ended window may be closed, and only here.
    update core.rule_revisions
    set valid_until = p_valid_from - 1,
        publication_status = 'SUPERSEDED'
    where rule_revision_id = v_predecessor;
  end if;

  update core.rule_revisions
  set publication_status = 'PUBLISHED',
      valid_from = p_valid_from
  where rule_revision_id = p_rule_revision_id;

  insert into audit.admin_audit_events (actor_user_id, action, target_kind, target_ref, detail_jsonb)
  values (
    auth.uid(),
    'PUBLISH_RULE_REVISION',
    'RULE_REVISION',
    p_rule_revision_id::text,
    jsonb_build_object(
      'ruleId', v_rule_id,
      'validFrom', p_valid_from,
      'candidateBundleHash', p_actual_candidate_hash,
      'supersededRevisionId', v_predecessor
    )
  );
end;
$$;

revoke all on function core.publish_rule_revision(uuid, date, core.sha256_hex, core.sha256_hex) from public;
grant execute on function core.publish_rule_revision(uuid, date, core.sha256_hex, core.sha256_hex)
  to cedula_admin_runtime_role;
