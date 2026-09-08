import "server-only";
import pg from "pg";
import { err, ok } from "../../../shared/result/result";
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
 * server-side prepared statement reuse; every query here is a plain text query
 * for exactly that reason.
 */
export function createKnowledgeReadAdapter(connectionString: string): KnowledgeReadPort {
  return {
    async loadBundleContentFor(effectiveLocalDate: LocalDate) {
      const client = new pg.Client({ connectionString });
      try {
        await client.connect();
      } catch (error) {
        return err<PortError>({
          kind: "PORT_ERROR",
          code: "UNAVAILABLE",
          detail: `cannot reach the knowledge database: ${String(error)}`,
        });
      }

      try {
        await client.query("begin isolation level repeatable read");
        const on = effectiveLocalDate as string;

        const live = `publication_status in ('PUBLISHED','SUPERSEDED')
          and valid_from <= $1::date and (valid_until is null or valid_until >= $1::date)`;

        const ruleSetRevisions = await client.query<Record<string, unknown>>(
          `select rule_set_revision_id, rule_set_id, publication_status,
                  to_char(valid_from,'YYYY-MM-DD') as valid_from,
                  to_char(valid_until,'YYYY-MM-DD') as valid_until
           from core.rule_set_revisions where ${live} order by rule_set_revision_id`,
          [on],
        );

        const ruleRevisions = await client.query<Record<string, unknown>>(
          `select r.rule_revision_id, r.rule_id, rs.rule_set_id, r.rule_set_revision_id, r.version,
                  r.publication_status, r.verification_status,
                  to_char(r.valid_from,'YYYY-MM-DD') as valid_from,
                  to_char(r.valid_until,'YYYY-MM-DD') as valid_until,
                  r.payload_schema_version, r.payload,
                  coalesce(
                    (select jsonb_agg(jsonb_build_object(
                        'sourceRevisionId', e.source_revision_id,
                        'citationDetail', e.citation_detail) order by e.source_revision_id)
                     from core.rule_evidence e where e.rule_revision_id = r.rule_revision_id),
                    '[]'::jsonb) as evidence
           from core.rule_revisions r
           join core.rules rs on rs.rule_id = r.rule_id
           where r.publication_status in ('PUBLISHED','SUPERSEDED')
             and r.valid_from <= $1::date and (r.valid_until is null or r.valid_until >= $1::date)
           order by r.rule_id`,
          [on],
        );

        const evidence = await client.query<Record<string, unknown>>(
          `select source_revision_id, source_id, publication_status, language,
                  to_char(retrieved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as retrieved_at, locator
           from core.source_revisions order by source_revision_id`,
        );

        const feeIndexRevisions = await client.query<Record<string, unknown>>(
          `select fee_index_revision_id, fee_index_id, publication_status, verification_status,
                  to_char(valid_from,'YYYY-MM-DD') as valid_from,
                  to_char(valid_until,'YYYY-MM-DD') as valid_until,
                  unit_amount_minor, unit_currency
           from core.fee_index_revisions where ${live} order by fee_index_revision_id`,
          [on],
        );

        const productPolicyRevisions = await client.query<Record<string, unknown>>(
          `select product_policy_revision_id, product_policy_id, publication_status,
                  to_char(valid_from,'YYYY-MM-DD') as valid_from,
                  to_char(valid_until,'YYYY-MM-DD') as valid_until,
                  -- Cast off the domain type: the driver has no array parser
                  -- registered for a domain over text, and would hand back the
                  -- raw literal instead of an array.
                  supported_desired_procedures::text[] as supported_desired_procedures
           from core.product_policy_revisions where ${live} order by product_policy_revision_id`,
          [on],
        );

        const productCoverageRevisions = await client.query<Record<string, unknown>>(
          `select product_coverage_revision_id, product_coverage_id, publication_status,
                  to_char(valid_from,'YYYY-MM-DD') as valid_from,
                  to_char(valid_until,'YYYY-MM-DD') as valid_until,
                  country_code, desired_procedure, state
           from core.product_coverage_revisions where ${live} order by product_coverage_revision_id`,
          [on],
        );

        const pathwayDefinitionRevisions = await client.query<Record<string, unknown>>(
          `select p.pathway_definition_revision_id, p.pathway_definition_id, d.pathway_id,
                  p.publication_status,
                  to_char(p.valid_from,'YYYY-MM-DD') as valid_from,
                  to_char(p.valid_until,'YYYY-MM-DD') as valid_until,
                  p.applies_to_case_types, p.sections
           from core.pathway_definition_revisions p
           join core.pathway_definitions d on d.pathway_definition_id = p.pathway_definition_id
           where p.publication_status in ('PUBLISHED','SUPERSEDED')
             and p.valid_from <= $1::date and (p.valid_until is null or p.valid_until >= $1::date)
           order by p.pathway_definition_revision_id`,
          [on],
        );

        await client.query("commit");

        const candidate = {
          schemaVersion: EVALUATION_BUNDLE_SCHEMA_VERSION,
          ruleSetRevisions: ruleSetRevisions.rows.map((row) => ({
            ruleSetRevisionId: row["rule_set_revision_id"],
            ruleSetId: row["rule_set_id"],
            publicationStatus: row["publication_status"],
            validFrom: row["valid_from"],
            validUntil: row["valid_until"],
          })),
          ruleRevisions: ruleRevisions.rows.map((row) => ({
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
          evidence: evidence.rows.map((row) => ({
            sourceRevisionId: row["source_revision_id"],
            sourceId: row["source_id"],
            publicationStatus: row["publication_status"],
            language: row["language"],
            retrievedAt: row["retrieved_at"],
            locator: row["locator"],
          })),
          feeIndexRevisions: feeIndexRevisions.rows.map((row) => ({
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
          productPolicyRevisions: productPolicyRevisions.rows.map((row) => ({
            productPolicyRevisionId: row["product_policy_revision_id"],
            productPolicyId: row["product_policy_id"],
            publicationStatus: row["publication_status"],
            validFrom: row["valid_from"],
            validUntil: row["valid_until"],
            supportedDesiredProcedures: row["supported_desired_procedures"],
          })),
          productCoverageRevisions: productCoverageRevisions.rows.map((row) => ({
            productCoverageRevisionId: row["product_coverage_revision_id"],
            productCoverageId: row["product_coverage_id"],
            publicationStatus: row["publication_status"],
            validFrom: row["valid_from"],
            validUntil: row["valid_until"],
            countryCode: row["country_code"],
            desiredProcedure: row["desired_procedure"],
            state: row["state"],
          })),
          pathwayDefinitionRevisions: pathwayDefinitionRevisions.rows.map((row) => ({
            pathwayDefinitionRevisionId: row["pathway_definition_revision_id"],
            pathwayDefinitionId: row["pathway_definition_id"],
            pathwayId: row["pathway_id"],
            publicationStatus: row["publication_status"],
            validFrom: row["valid_from"],
            validUntil: row["valid_until"],
            appliesToCaseTypes: row["applies_to_case_types"],
            sections: row["sections"],
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
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return err<PortError>({
          kind: "PORT_ERROR",
          code: "UNAVAILABLE",
          detail: String(error),
        });
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}
