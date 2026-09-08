import "server-only";
import { err, ok } from "../../../shared/result/result";
import { openInternalConnection, type Tx } from "../../database/connection";
import type { LocalDate } from "../../../domain/primitives/local-date";
import type { EvaluationBundleContent } from "../../../rules/bundle/bundle-content";
import { EVALUATION_BUNDLE_SCHEMA_VERSION } from "../../../rules/bundle/bundle-content";
import { evaluationBundleContentSchema } from "../../../rules/validation/schemas";
import type { KnowledgeReadPort, PortError } from "../../../application/ports/ports";

/**
 * Assembles an evaluation bundle for one effective date.
 *
 * Uses a direct connection rather than the Data API for two reasons: the whole
 * assembly must happen inside ONE `REPEATABLE READ` transaction so a concurrent
 * publication cannot be half-seen, and PostgREST cannot express that.
 *
 * Behind Supavisor's transaction pooler there is no session affinity and no
 * server-side prepared statement reuse, which is why the connection is opened
 * with prepared statements switched off.
 */
export function createKnowledgeReadAdapter(connectionString: string): KnowledgeReadPort {
  return {
    async loadBundleContentFor(effectiveLocalDate: LocalDate) {
      const sql = openInternalConnection(connectionString);
      // `begin` unwraps whatever the callback returns, so the outcome is
      // captured rather than returned through it.
      let outcome: BundleOutcome | null = null;
      try {
        await sql.begin("isolation level repeatable read", async (tx: Tx) => {
          outcome = await loadBundle(tx, effectiveLocalDate);
        });
        return (
          outcome ??
          err<PortError>({
            kind: "PORT_ERROR",
            code: "UNAVAILABLE",
            detail: "the knowledge transaction produced no result",
          })
        );
      } catch (error) {
        return err<PortError>({
          kind: "PORT_ERROR",
          code: "UNAVAILABLE",
          detail: `cannot reach the knowledge database: ${String(error)}`,
        });
      } finally {
        await sql.end().catch(() => undefined);
      }
    },
  };
}

/**
 * The whole assembly, inside one transaction.
 *
 * Every query reads the same snapshot, so a publication that commits halfway
 * through cannot be half-seen: either the bundle is entirely before it or
 * entirely after it.
 */
type BundleOutcome = Awaited<ReturnType<KnowledgeReadPort["loadBundleContentFor"]>>;

async function loadBundle(tx: Tx, effectiveLocalDate: LocalDate): Promise<BundleOutcome> {
  const on = effectiveLocalDate as string;

  const ruleSetRevisions = await tx<Record<string, unknown>[]>`
    select rule_set_revision_id, rule_set_id, publication_status,
           to_char(valid_from,'YYYY-MM-DD') as valid_from,
           to_char(valid_until,'YYYY-MM-DD') as valid_until
    from core.rule_set_revisions
    where publication_status in ('PUBLISHED','SUPERSEDED')
      and valid_from <= ${on}::date and (valid_until is null or valid_until >= ${on}::date)
    order by rule_set_revision_id`;

  const ruleRevisions = await tx<Record<string, unknown>[]>`
    select r.rule_revision_id, r.rule_id, rs.rule_set_id, r.rule_set_revision_id, r.version,
           r.publication_status, r.verification_status,
           to_char(r.valid_from,'YYYY-MM-DD') as valid_from,
           to_char(r.valid_until,'YYYY-MM-DD') as valid_until,
           r.payload_schema_version, r.payload,
           coalesce(
             (select jsonb_agg(jsonb_build_object(
                 'sourceRevisionId', e.source_revision_id,
                 'role', e.role,
                 'claimSummary', e.claim_summary,
                 'citationDetail', e.citation_detail,
                 'quote', e.quote) order by e.source_revision_id)
              from core.rule_evidence e where e.rule_revision_id = r.rule_revision_id),
             '[]'::jsonb) as evidence
    from core.rule_revisions r
    join core.rules rs on rs.rule_id = r.rule_id
    where r.publication_status in ('PUBLISHED','SUPERSEDED')
      and r.valid_from <= ${on}::date and (r.valid_until is null or r.valid_until >= ${on}::date)
    order by r.rule_id`;

  const evidence = await tx<Record<string, unknown>[]>`
    select source_revision_id, source_id, publication_status, language,
           to_char(published_at,'YYYY-MM-DD') as published_at,
           to_char(retrieved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as retrieved_at,
           to_char(effective_from,'YYYY-MM-DD') as effective_from,
           to_char(effective_until,'YYYY-MM-DD') as effective_until,
           supersedes, confidence, notes, locator
    from core.source_revisions order by source_revision_id`;

  const feeIndexRevisions = await tx<Record<string, unknown>[]>`
    select fee_index_revision_id, fee_index_id, publication_status, verification_status,
           to_char(valid_from,'YYYY-MM-DD') as valid_from,
           to_char(valid_until,'YYYY-MM-DD') as valid_until,
           unit_amount_minor, unit_currency
    from core.fee_index_revisions
    where publication_status in ('PUBLISHED','SUPERSEDED')
      and valid_from <= ${on}::date and (valid_until is null or valid_until >= ${on}::date)
    order by fee_index_revision_id`;

  const productPolicyRevisions = await tx<Record<string, unknown>[]>`
    select product_policy_revision_id, product_policy_id, publication_status,
           to_char(valid_from,'YYYY-MM-DD') as valid_from,
           to_char(valid_until,'YYYY-MM-DD') as valid_until,
           payload_schema_version, payload
    from core.product_policy_revisions
    where publication_status in ('PUBLISHED','SUPERSEDED')
      and valid_from <= ${on}::date and (valid_until is null or valid_until >= ${on}::date)
    order by product_policy_revision_id`;

  const productCoverageRevisions = await tx<Record<string, unknown>[]>`
    select product_coverage_revision_id, product_coverage_id, publication_status,
           to_char(valid_from,'YYYY-MM-DD') as valid_from,
           to_char(valid_until,'YYYY-MM-DD') as valid_until,
           country_code, desired_procedure, state
    from core.product_coverage_revisions
    where publication_status in ('PUBLISHED','SUPERSEDED')
      and valid_from <= ${on}::date and (valid_until is null or valid_until >= ${on}::date)
    order by product_coverage_revision_id`;

  const pathwayDefinitionRevisions = await tx<Record<string, unknown>[]>`
    select p.pathway_definition_revision_id, p.pathway_definition_id, d.pathway_id,
           p.publication_status,
           to_char(p.valid_from,'YYYY-MM-DD') as valid_from,
           to_char(p.valid_until,'YYYY-MM-DD') as valid_until,
           p.payload_schema_version, p.payload
    from core.pathway_definition_revisions p
    join core.pathway_definitions d on d.pathway_definition_id = p.pathway_definition_id
    where p.publication_status in ('PUBLISHED','SUPERSEDED')
      and p.valid_from <= ${on}::date and (p.valid_until is null or p.valid_until >= ${on}::date)
    order by p.pathway_definition_revision_id`;

  const candidate = {
    schemaVersion: EVALUATION_BUNDLE_SCHEMA_VERSION,
    ruleSetRevisions: ruleSetRevisions.map((row) => ({
      ruleSetRevisionId: row["rule_set_revision_id"],
      ruleSetId: row["rule_set_id"],
      publicationStatus: row["publication_status"],
      validFrom: row["valid_from"],
      validUntil: row["valid_until"],
    })),
    ruleRevisions: ruleRevisions.map((row) => ({
      ruleRevisionId: row["rule_revision_id"],
      ruleId: row["rule_id"],
      ruleSetId: row["rule_set_id"],
      ruleSetRevisionId: row["rule_set_revision_id"],
      version: row["version"],
      publicationStatus: row["publication_status"],
      verificationStatus: row["verification_status"],
      validFrom: row["valid_from"],
      validUntil: row["valid_until"],
      payloadSchemaVersion: row["payload_schema_version"],
      payload: row["payload"],
      evidence: row["evidence"],
    })),
    evidence: evidence.map((row) => ({
      sourceRevisionId: row["source_revision_id"],
      sourceId: row["source_id"],
      publicationStatus: row["publication_status"],
      language: row["language"],
      publishedAt: row["published_at"],
      retrievedAt: row["retrieved_at"],
      effectiveFrom: row["effective_from"],
      effectiveUntil: row["effective_until"],
      supersedes: row["supersedes"],
      confidence: row["confidence"],
      notes: row["notes"],
      locator: row["locator"],
    })),
    feeIndexRevisions: feeIndexRevisions.map((row) => ({
      feeIndexRevisionId: row["fee_index_revision_id"],
      feeIndexId: row["fee_index_id"],
      publicationStatus: row["publication_status"],
      verificationStatus: row["verification_status"],
      validFrom: row["valid_from"],
      validUntil: row["valid_until"],
      unitAmount: {
        amountMinorUnits: Number(row["unit_amount_minor"]),
        currency: row["unit_currency"],
      },
    })),
    productPolicyRevisions: productPolicyRevisions.map((row) => ({
      productPolicyRevisionId: row["product_policy_revision_id"],
      productPolicyId: row["product_policy_id"],
      publicationStatus: row["publication_status"],
      validFrom: row["valid_from"],
      validUntil: row["valid_until"],
      payloadSchemaVersion: row["payload_schema_version"],
      payload: row["payload"],
    })),
    productCoverageRevisions: productCoverageRevisions.map((row) => ({
      productCoverageRevisionId: row["product_coverage_revision_id"],
      productCoverageId: row["product_coverage_id"],
      publicationStatus: row["publication_status"],
      validFrom: row["valid_from"],
      validUntil: row["valid_until"],
      countryCode: row["country_code"],
      desiredProcedure: row["desired_procedure"],
      state: row["state"],
    })),
    pathwayDefinitionRevisions: pathwayDefinitionRevisions.map((row) => ({
      pathwayDefinitionRevisionId: row["pathway_definition_revision_id"],
      pathwayDefinitionId: row["pathway_definition_id"],
      pathwayId: row["pathway_id"],
      publicationStatus: row["publication_status"],
      validFrom: row["valid_from"],
      validUntil: row["valid_until"],
      payloadSchemaVersion: row["payload_schema_version"],
      payload: row["payload"],
    })),
  };

  // Database rows are re-validated before they can reach the engine. A
  // corrupted or hand-edited row must fail loudly rather than be
  // interpreted.
  const parsed = evaluationBundleContentSchema.safeParse(candidate);
  if (!parsed.success) {
    return err<PortError>({
      kind: "PORT_ERROR",
      code: "INVARIANT_VIOLATION",
      detail: `stored knowledge failed validation: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`,
    });
  }
  return ok<EvaluationBundleContent>(parsed.data);
}
