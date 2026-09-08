import type { RuleRevision, RuleSetRevision } from "../../src/rules/definitions/rule-revision";
import { RULE_PAYLOAD_SCHEMA_VERSION } from "../../src/rules/definitions/rule-revision";
import type { PrecedenceEdge, RulePayload } from "../../src/rules/definitions/payloads";
import type { RuleConditionNode } from "../../src/rules/definitions/ast";
import type { VerificationStatus } from "../../src/domain/rules/verification";
import type { EvaluationBundleContent } from "../../src/rules/bundle/bundle-content";
import { EVALUATION_BUNDLE_SCHEMA_VERSION } from "../../src/rules/bundle/bundle-content";
import { prepareEngineReadyBundle } from "../../src/rules/bundle/engine-ready-bundle";
import type { EngineReadyBundleContent } from "../../src/rules/bundle/engine-ready-bundle";
import type { SourceRevision } from "../../src/domain/sources/source";
import type { FeeIndexRevision } from "../../src/domain/fees/fee";
import type {
  PathwayDefinitionRevision,
  ProductCoverageRevision,
  ProductPolicyRevision,
  ProductPolicyRule,
} from "../../src/domain/product/product";
import {
  PATHWAY_PAYLOAD_SCHEMA_VERSION,
  PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION,
} from "../../src/domain/product/product";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { id, testUuid } from "./ids";

/**
 * SYNTHETIC TEST RULES.
 *
 * Everything built here is invented for testing the engine's mechanics. None
 * of it is a statement about Paraguayan law, and none of it is ever seeded
 * into a production knowledge base - production rule content may only come
 * from the approved research baseline.
 */
export const TEST_SOURCE_REVISION_ID = testUuid(9001);
export const TEST_RULE_SET_REVISION_ID = testUuid(9002);

export const alwaysTrue: RuleConditionNode = { kind: "CONSTANT", value: "TRUE" };
export const alwaysFalse: RuleConditionNode = { kind: "CONSTANT", value: "FALSE" };
export const alwaysIndeterminate: RuleConditionNode = { kind: "CONSTANT", value: "INDETERMINATE" };

export function testSourceRevision(): SourceRevision {
  return {
    sourceRevisionId: id("" + TEST_SOURCE_REVISION_ID),
    sourceId: id("synthetic.test.source"),
    publicationStatus: "PUBLISHED",
    language: id("es"),
    publishedAt: null,
    retrievedAt: id("2026-01-01T00:00:00Z"),
    effectiveFrom: null,
    effectiveUntil: null,
    supersedes: null,
    confidence: "HIGH",
    notes: null,
    locator: "synthetic://test-source",
  };
}

export function testRuleSetRevision(): RuleSetRevision {
  return {
    ruleSetRevisionId: id(TEST_RULE_SET_REVISION_ID),
    ruleSetId: id("synthetic.test.ruleset"),
    publicationStatus: "PUBLISHED",
    validFrom: "2000-01-01" as LocalDate,
    validUntil: null,
  };
}

let ruleCounter = 0;

export function rule(
  ruleId: string,
  payload: RulePayload,
  options: Partial<
    Pick<RuleRevision, "verificationStatus" | "validFrom" | "validUntil" | "publicationStatus">
  > & Readonly<{ precedence?: readonly PrecedenceEdge[] }> = {},
): RuleRevision {
  ruleCounter += 1;
  const verificationStatus: VerificationStatus = options.verificationStatus ?? "CONFIRMED";
  const resolved = verificationStatus === "CONFIRMED" || verificationStatus === "STRONG_EVIDENCE";
  /*
   * The revision's evidence status and the payload's resolution have to agree,
   * so the fixture derives the resolution from the status a test asks for
   * rather than letting a test build a rule the validator would reject.
   */
  const resolution: RulePayload["resolution"] = resolved
    ? payload.resolution
    : payload.resolution.state === "UNRESOLVED"
      ? { ...payload.resolution, reason: verificationStatus }
      : {
          state: "UNRESOLVED",
          reason: verificationStatus,
          verification: {
            code: "CASE_CLASSIFICATION_UNCONFIRMED",
            target: { kind: "CASE" },
          },
        };
  return {
    ruleRevisionId: id(testUuid(ruleCounter)),
    ruleId: id(ruleId),
    ruleSetId: id("synthetic.test.ruleset"),
    ruleSetRevisionId: id(TEST_RULE_SET_REVISION_ID),
    version: 1 as RuleRevision["version"],
    publicationStatus: options.publicationStatus ?? "PUBLISHED",
    verificationStatus,
    validFrom: options.validFrom ?? ("2000-01-01" as LocalDate),
    validUntil: options.validUntil ?? null,
    payloadSchemaVersion: RULE_PAYLOAD_SCHEMA_VERSION,
    payload: {
      ...payload,
      precedence: options.precedence ?? payload.precedence,
      resolution,
    } as RulePayload,
    evidence: resolved
      ? [
          {
            sourceRevisionId: id(TEST_SOURCE_REVISION_ID),
            role: "SUPPORTS",
            claimSummary: "synthetic",
            citationDetail: "synthetic",
            quote: null,
          },
        ]
      : [],
  };
}

export type BundleExtras = Readonly<{
  feeIndexRevisions?: readonly FeeIndexRevision[];
  productPolicyRevisions?: readonly ProductPolicyRevision[];
  productCoverageRevisions?: readonly ProductCoverageRevision[];
  pathwayDefinitionRevisions?: readonly PathwayDefinitionRevision[];
  evidence?: readonly SourceRevision[];
}>;

export function bundleContent(
  rules: readonly RuleRevision[],
  extras: BundleExtras = {},
): EvaluationBundleContent {
  return {
    schemaVersion: EVALUATION_BUNDLE_SCHEMA_VERSION,
    ruleSetRevisions: [testRuleSetRevision()],
    ruleRevisions: rules,
    evidence: extras.evidence ?? [testSourceRevision()],
    feeIndexRevisions: extras.feeIndexRevisions ?? [],
    productPolicyRevisions: extras.productPolicyRevisions ?? [],
    productCoverageRevisions: extras.productCoverageRevisions ?? [],
    pathwayDefinitionRevisions: extras.pathwayDefinitionRevisions ?? [],
  };
}

export function engineReadyBundle(
  rules: readonly RuleRevision[],
  effectiveLocalDate: string,
  extras: BundleExtras = {},
): EngineReadyBundleContent {
  return unwrapOrThrow(
    prepareEngineReadyBundle(
      bundleContent(rules, extras),
      effectiveLocalDate as LocalDate,
      CURRENT_ENGINE_DESCRIPTOR,
    ),
  );
}

export function supportedCoverage(
  countryCode: string,
  state: ProductCoverageRevision["state"] = "SUPPORTED",
): ProductCoverageRevision {
  ruleCounter += 1;
  return {
    productCoverageRevisionId: id(testUuid(7000 + ruleCounter)),
    productCoverageId: id(`synthetic.coverage.${countryCode.toLowerCase()}`),
    publicationStatus: "PUBLISHED",
    validFrom: "2000-01-01" as LocalDate,
    validUntil: null,
    countryCode: id(countryCode),
    desiredProcedure: "FIRST_CEDULA",
    state,
  };
}

/**
 * The minimal policy every engine test needs.
 *
 * It declares the product serves first-cedula cases, and gives the two
 * coverage states that must be governed explicitly - PARTIAL and
 * RESEARCH_REQUIRED - the effects they need. Without those two rules the
 * engine refuses to evaluate a partial or unresearched case, which is exactly
 * the behaviour under test elsewhere.
 */
export function firstCedulaPolicy(
  rules: readonly ProductPolicyRule[] = DEFAULT_POLICY_RULES,
): ProductPolicyRevision {
  return {
    productPolicyRevisionId: id(testUuid(7999)),
    productPolicyId: id("synthetic.policy.mvp"),
    publicationStatus: "PUBLISHED",
    validFrom: "2000-01-01" as LocalDate,
    validUntil: null,
    payloadSchemaVersion: PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION,
    payload: { supportedDesiredProcedures: ["FIRST_CEDULA"], rules },
  };
}

export function anyCase(): ProductPolicyRule["condition"] {
  return { coverageStates: [], desiredProcedures: [], countries: [], caseTypes: [] };
}

export const DEFAULT_POLICY_RULES: readonly ProductPolicyRule[] = [
  {
    policyRuleKey: "partial-coverage-warning",
    condition: { ...anyCase(), coverageStates: ["PARTIAL"] },
    effect: { kind: "WARNING", code: "PARTIAL_COVERAGE" },
  },
  {
    policyRuleKey: "research-required",
    condition: { ...anyCase(), coverageStates: ["RESEARCH_REQUIRED"] },
    effect: { kind: "VERIFICATION_REQUIRED", code: "PRODUCT_COVERAGE_RESEARCH_REQUIRED" },
  },
];

export function pathway(
  pathwayId: string,
  appliesToCaseTypes: readonly string[],
  sections: PathwayDefinitionRevision["payload"]["sections"] = [],
): PathwayDefinitionRevision {
  ruleCounter += 1;
  return {
    pathwayDefinitionRevisionId: id(testUuid(8000 + ruleCounter)),
    pathwayDefinitionId: id(`synthetic.pathway.${pathwayId}`),
    pathwayId: id(pathwayId),
    publicationStatus: "PUBLISHED",
    validFrom: "2000-01-01" as LocalDate,
    validUntil: null,
    payloadSchemaVersion: PATHWAY_PAYLOAD_SCHEMA_VERSION,
    payload: { appliesToCaseTypes, sections },
  };
}

export function feeIndexRevision(
  feeIndexId: string,
  amountMinorUnits: number,
  options: Partial<Pick<FeeIndexRevision, "validFrom" | "validUntil" | "verificationStatus" | "publicationStatus">> = {},
): FeeIndexRevision {
  ruleCounter += 1;
  return {
    feeIndexRevisionId: id(testUuid(6000 + ruleCounter)),
    feeIndexId: id(feeIndexId),
    publicationStatus: options.publicationStatus ?? "PUBLISHED",
    verificationStatus: options.verificationStatus ?? "CONFIRMED",
    validFrom: options.validFrom ?? ("2000-01-01" as LocalDate),
    validUntil: options.validUntil ?? null,
    unitAmount: { amountMinorUnits, currency: id("PYG") },
  };
}

export function resetRuleCounter(): void {
  ruleCounter = 0;
}
