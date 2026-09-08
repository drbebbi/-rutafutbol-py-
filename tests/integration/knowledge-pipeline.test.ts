import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ADMIN, connect, databaseAvailable, DATABASE_URL, uniqueSlug } from "../persistence/db";
import {
  computeCandidateBundleHash,
  createRulePublicationAdapter,
} from "../../src/infrastructure/repositories/internal/publication-adapter";
import type { RuleRevisionId, UserId } from "../../src/domain/identifiers/identifiers";
import { createKnowledgeReadAdapter } from "../../src/infrastructure/repositories/public-read/knowledge-read-adapter";
import { evaluateCaseForUser } from "../../src/application/evaluations/evaluate-case-service";
import { canonicalContentHash } from "../../src/infrastructure/hashing/content-hash";
import { createBundleStoreAdapter } from "../../src/infrastructure/repositories/privileged/bundle-store-adapter";
import { userCaseFacts } from "../fixtures/facts";
import { DEFAULT_INSTANT } from "../fixtures/engine";
import type { CaseEvaluationRepositoryPort } from "../../src/application/ports/ports";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { evaluationBundleContentHash } from "../../src/rules/bundle/canonical-bundle";

const maybe = databaseAvailable ? describe : describe.skip;

/**
 * The whole knowledge path, for real: rows in `core` -> a REPEATABLE READ
 * bundle assembly -> schema re-validation -> the engine -> a decision.
 *
 * The rules inserted here are synthetic. What is being tested is the pipeline,
 * not any legal statement.
 */
maybe("knowledge pipeline", () => {
  let client: pg.Client;
  const ids = {
    authority: uniqueSlug("i.authority"),
    ruleSet: uniqueSlug("i.set"),
    caseTypeRule: uniqueSlug("i.rule.case-type"),
    procedureRule: uniqueSlug("i.rule.procedure"),
    procedure: uniqueSlug("i.procedure"),
    policy: uniqueSlug("i.policy"),
    coverage: uniqueSlug("i.coverage"),
    pathwayDefinition: uniqueSlug("i.pathway"),
    pathway: uniqueSlug("i.pathway-id"),
    source: uniqueSlug("i.source"),
  };
  let sourceRevisionId = "";
  let ruleSetRevisionId = "";

  beforeAll(async () => {
    client = await connect();
    const migration = readFileSync(
      resolve(import.meta.dirname, "../..", join("supabase", "migrations", "0002_core_knowledge.sql")),
      "utf8",
    );
    expect(migration).toContain("core.rule_revisions");

    // Start from clean knowledge: other suites publish synthetic revisions, and
    // a bundle assembled from somebody else's leftovers proves nothing.
    await client.query("delete from core.rule_evidence");
    await client.query("delete from core.rule_revisions");
    await client.query("delete from core.rules");
    await client.query("delete from core.pathway_definition_revisions");
    await client.query("delete from core.pathway_definitions");
    await client.query("delete from core.product_coverage_revisions");
    await client.query("delete from core.product_coverages");
    await client.query("delete from core.product_policy_revisions");
    await client.query("delete from core.product_policies");

    await client.query("insert into core.countries (country_code, label) values ('DE','Germany') on conflict do nothing");
    await client.query("insert into core.authorities (authority_id, country_code, label) values ($1,'DE','Test')", [ids.authority]);
    await client.query("insert into core.procedures (procedure_id, authority_id, label) values ($1,$2,'Test')", [ids.procedure, ids.authority]);
    await client.query("insert into core.sources (source_id, authority_id, kind, citation) values ($1,$2,'OFFICIAL_WEBSITE','synthetic')", [ids.source, ids.authority]);
    sourceRevisionId = (
      await client.query<{ source_revision_id: string }>(
        "insert into core.source_revisions (source_id, publication_status, language, retrieved_at, locator) values ($1,'PUBLISHED','es', now(), 'synthetic://x') returning source_revision_id",
        [ids.source],
      )
    ).rows[0]?.source_revision_id as string;

    await client.query("insert into core.rule_sets (rule_set_id, label) values ($1,'Test')", [ids.ruleSet]);
    ruleSetRevisionId = (
      await client.query<{ rule_set_revision_id: string }>(
        "insert into core.rule_set_revisions (rule_set_id, publication_status, valid_from) values ($1,'PUBLISHED','2000-01-01') returning rule_set_revision_id",
        [ids.ruleSet],
      )
    ).rows[0]?.rule_set_revision_id as string;

    const insertRule = async (ruleId: string, payload: unknown): Promise<string> => {
      await client.query("insert into core.rules (rule_id, rule_set_id, label) values ($1,$2,'Test')", [ruleId, ids.ruleSet]);
      const inserted = await client.query<{ rule_revision_id: string }>(
        `insert into core.rule_revisions (rule_id, rule_set_revision_id, version, publication_status,
           verification_status, valid_from, payload_schema_version, payload)
         values ($1,$2,1,'PUBLISHED','CONFIRMED','2000-01-01','rule-payload@2.0',$3::jsonb)
         returning rule_revision_id`,
        [ruleId, ruleSetRevisionId, JSON.stringify(payload)],
      );
      const revisionId = inserted.rows[0]?.rule_revision_id as string;
      await client.query(
        `insert into core.rule_evidence
           (rule_revision_id, source_revision_id, role, claim_summary, citation_detail, quote)
         values ($1,$2,'SUPPORTS','synthetic','synthetic',null)`,
        [revisionId, sourceRevisionId],
      );
      return revisionId;
    };

    await insertRule(ids.caseTypeRule, {
      family: "CLASSIFICATION",
      scope: "CASE",
      subject: "CASE_TYPE",
      condition: { kind: "CONSTANT", value: "TRUE" },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: { kind: "CASE_TYPE", caseType: "STANDARD_FIRST_CEDULA_FROM_NONE" },
      },
    });
    await insertRule(ids.procedureRule, {
      family: "PROCEDURE",
      scope: "CASE",
      condition: { kind: "CONSTANT", value: "TRUE" },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: {
          procedureId: ids.procedure,
          parameters: [],
          discriminator: null,
          requirement: "REQUIRED",
        },
      },
    });

    await client.query("insert into core.product_policies (product_policy_id, label) values ($1,'Test')", [ids.policy]);
    await client.query(
      `insert into core.product_policy_revisions
         (product_policy_id, publication_status, valid_from, payload_schema_version, payload)
       values ($1,'PUBLISHED','2000-01-01','product-policy@1.0', $2::jsonb)`,
      [
        ids.policy,
        JSON.stringify({
          supportedDesiredProcedures: ["FIRST_CEDULA"],
          rules: [
            {
              policyRuleKey: "research-required",
              condition: {
                coverageStates: ["RESEARCH_REQUIRED"],
                desiredProcedures: [],
                countries: [],
                caseTypes: [],
              },
              effect: {
                kind: "VERIFICATION_REQUIRED",
                code: "PRODUCT_COVERAGE_RESEARCH_REQUIRED",
              },
            },
          ],
        }),
      ],
    );
    await client.query("insert into core.product_coverages (product_coverage_id, label) values ($1,'Test')", [ids.coverage]);
    await client.query(
      "insert into core.product_coverage_revisions (product_coverage_id, publication_status, valid_from, country_code, desired_procedure, state) values ($1,'PUBLISHED','2000-01-01','DE','FIRST_CEDULA','SUPPORTED')",
      [ids.coverage],
    );
    await client.query("insert into core.pathway_definitions (pathway_definition_id, pathway_id, label) values ($1,$2,'Test')", [ids.pathwayDefinition, ids.pathway]);
    await client.query(
      `insert into core.pathway_definition_revisions
         (pathway_definition_id, publication_status, valid_from, payload_schema_version, payload)
       values ($1,'PUBLISHED','2000-01-01','pathway-definition@1.0', $2::jsonb)`,
      [
        ids.pathwayDefinition,
        JSON.stringify({
          appliesToCaseTypes: ["STANDARD_FIRST_CEDULA_FROM_NONE"],
          sections: [],
        }),
      ],
    );
  });

  afterAll(async () => {
    await client.query("delete from core.rule_evidence");
    await client.query("delete from core.rule_revisions");
    await client.query("delete from core.rules");
    await client.query("delete from core.pathway_definition_revisions");
    await client.query("delete from core.pathway_definitions");
    await client.end();
  });

  it("assembles a bundle from the database and evaluates it", async () => {
    const knowledge = createKnowledgeReadAdapter(DATABASE_URL);
    const evaluations: CaseEvaluationRepositoryPort = {
      record: () => Promise.resolve({ ok: false, error: { kind: "PORT_ERROR", code: "NOT_AUTHORIZED", detail: "anonymous" } }),
      listForCase: () => Promise.resolve({ ok: true, value: [] }),
    };

    const outcome = await evaluateCaseForUser(
      userCaseFacts(),
      {
        clock: { nowInstant: () => DEFAULT_INSTANT },
        hash: { canonicalHash: canonicalContentHash },
        knowledge,
        bundleStore: createBundleStoreAdapter(DATABASE_URL),
        evaluations,
      },
      null,
    );

    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.value.decision.caseClassification.caseType).toBe("STANDARD_FIRST_CEDULA_FROM_NONE");
    expect(outcome.value.decision.requiredProcedures).toHaveLength(1);
    expect(outcome.value.bundleContentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("produces the same content hash on a second read of unchanged knowledge", async () => {
    const knowledge = createKnowledgeReadAdapter(DATABASE_URL);
    const first = await knowledge.loadBundleContentFor("2026-06-15" as LocalDate);
    const second = await knowledge.loadBundleContentFor("2026-06-15" as LocalDate);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(evaluationBundleContentHash(second.value)).toBe(evaluationBundleContentHash(first.value));
  });

  it("materialises the bundle once and reuses the row", async () => {
    const knowledge = createKnowledgeReadAdapter(DATABASE_URL);
    const content = await knowledge.loadBundleContentFor("2026-06-15" as LocalDate);
    expect(content.ok).toBe(true);
    if (!content.ok) {
      return;
    }
    const store = createBundleStoreAdapter(DATABASE_URL);
    const hash = evaluationBundleContentHash(content.value);
    const a = await store.materialize(hash, content.value.schemaVersion, content.value);
    const b = await store.materialize(hash, content.value.schemaVersion, content.value);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.value).toBe(b.ok ? b.value : "");
  });
});

/**
 * Publication drift, end to end.
 *
 * The scenario the audit asked for: a candidate is validated and its hash H1
 * approved; a *different* decision-affecting rule then changes; publishing
 * against H1 must fail. It has to fail even though the publisher passes the
 * approved hash and nothing else, because the publication transaction is the
 * only party that gets to say what the candidate currently is.
 */
maybe("publication drift detection", () => {
  let client: pg.Client;
  const ids = {
    authority: uniqueSlug("d.authority"),
    ruleSet: uniqueSlug("d.set"),
    target: uniqueSlug("d.rule.target"),
    other: uniqueSlug("d.rule.other"),
    source: uniqueSlug("d.source"),
    policy: uniqueSlug("d.policy"),
    pathwayDefinition: uniqueSlug("d.pathway"),
    pathway: uniqueSlug("d.pathway-id"),
  };
  let ruleSetRevisionId = "";
  let sourceRevisionId = "";
  const on = "2026-06-15" as LocalDate;

  const warningPayload = (severity: string): string =>
    JSON.stringify({
      family: "WARNING",
      scope: "CASE",
      condition: { kind: "CONSTANT", value: "TRUE" },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: { code: "FEE_MAY_CHANGE", severity, qualifier: null },
      },
    });

  async function insertRule(ruleId: string, status: string, payload: string): Promise<string> {
    await client.query("insert into core.rules (rule_id, rule_set_id, label) values ($1,$2,'Test')", [
      ruleId,
      ids.ruleSet,
    ]);
    const inserted = await client.query<{ rule_revision_id: string }>(
      `insert into core.rule_revisions (rule_id, rule_set_revision_id, version, publication_status,
         verification_status, valid_from, payload_schema_version, payload)
       values ($1,$2,1,$3,'CONFIRMED','2000-01-01','rule-payload@2.0',$4::jsonb)
       returning rule_revision_id`,
      [ruleId, ruleSetRevisionId, status, payload],
    );
    const revisionId = inserted.rows[0]?.rule_revision_id as string;
    await client.query(
      `insert into core.rule_evidence
         (rule_revision_id, source_revision_id, role, claim_summary, citation_detail, quote)
       values ($1,$2,'SUPPORTS','synthetic','synthetic',null)`,
      [revisionId, sourceRevisionId],
    );
    return revisionId;
  }

  beforeAll(async () => {
    client = await connect();
    await client.query("delete from core.rule_evidence");
    await client.query("delete from core.rule_revisions");
    await client.query("delete from core.rules");

    await client.query("insert into core.countries (country_code, label) values ('DE','Germany') on conflict do nothing");
    await client.query("insert into core.authorities (authority_id, country_code, label) values ($1,'DE','Test')", [ids.authority]);
    await client.query("insert into core.sources (source_id, authority_id, kind, citation) values ($1,$2,'OFFICIAL_WEBSITE','synthetic')", [ids.source, ids.authority]);
    sourceRevisionId = (
      await client.query<{ source_revision_id: string }>(
        "insert into core.source_revisions (source_id, publication_status, language, retrieved_at, locator) values ($1,'PUBLISHED','es', now(), 'synthetic://d') returning source_revision_id",
        [ids.source],
      )
    ).rows[0]?.source_revision_id as string;
    await client.query("insert into core.rule_sets (rule_set_id, label) values ($1,'Test')", [ids.ruleSet]);
    ruleSetRevisionId = (
      await client.query<{ rule_set_revision_id: string }>(
        "insert into core.rule_set_revisions (rule_set_id, publication_status, valid_from) values ($1,'PUBLISHED','2000-01-01') returning rule_set_revision_id",
        [ids.ruleSet],
      )
    ).rows[0]?.rule_set_revision_id as string;

    await client.query(
      "insert into security.admin_authorizations (user_id, admin_role) values ($1,'ADMIN'),($1,'PUBLISHER') on conflict do nothing",
      [ADMIN],
    );
  });

  afterAll(async () => {
    await client.end();
  });

  it("refuses to publish once another decision-affecting rule has changed", async () => {
    const target = await insertRule(ids.target, "APPROVED", warningPayload("INFO"));
    const other = await insertRule(ids.other, "PUBLISHED", warningPayload("INFO"));

    // Validate the candidate: the knowledge base as it would be with the
    // approved revision live. This is the hash a publisher approves.
    const approved = await computeCandidateBundleHash(DATABASE_URL, {
      ruleRevisionId: target as RuleRevisionId,
      validFrom: on,
    });
    expect(approved).not.toBeNull();
    if (approved === null) {
      return;
    }

    // Now a *different* rule changes. Nothing about the approved revision
    // moved, and the publisher still holds hash H1.
    await client.query(
      "update core.rule_revisions set payload = $2::jsonb where rule_revision_id = $1",
      [other, warningPayload("CAUTION")],
    );

    const publication = createRulePublicationAdapter(DATABASE_URL);
    const outcome = await publication.publish({
      actorUserId: ADMIN as UserId,
      ruleRevisionId: target as RuleRevisionId,
      validFrom: on,
      approvedCandidateBundleHash: approved,
    });

    expect(outcome.ok).toBe(false);
    // Not "the caller passed two different hashes": the transaction worked out
    // for itself that the knowledge base no longer matches the approval.
    expect(!outcome.ok && outcome.error.kind).toBe("STALE");

    const status = await client.query<{ publication_status: string }>(
      "select publication_status from core.rule_revisions where rule_revision_id = $1",
      [target],
    );
    expect(status.rows[0]?.publication_status).toBe("APPROVED");
  });

  it("publishes when nothing moved, so the refusal above is not vacuous", async () => {
    const target = await insertRule(uniqueSlug("d.rule.clean"), "APPROVED", warningPayload("INFO"));
    const approved = await computeCandidateBundleHash(DATABASE_URL, {
      ruleRevisionId: target as RuleRevisionId,
      validFrom: on,
    });
    expect(approved).not.toBeNull();
    if (approved === null) {
      return;
    }

    const outcome = await createRulePublicationAdapter(DATABASE_URL).publish({
      actorUserId: ADMIN as UserId,
      ruleRevisionId: target as RuleRevisionId,
      validFrom: on,
      approvedCandidateBundleHash: approved,
    });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);

    const status = await client.query<{ publication_status: string }>(
      "select publication_status from core.rule_revisions where rule_revision_id = $1",
      [target],
    );
    expect(status.rows[0]?.publication_status).toBe("PUBLISHED");
  });
});
