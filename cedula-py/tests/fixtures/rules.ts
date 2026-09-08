import type { RuleRevision, RuleSetRevision } from "../../src/rules/definitions/rule-revision";
import { RULE_PAYLOAD_SCHEMA_VERSION } from "../../src/rules/definitions/rule-revision";
import type { RulePayload } from "../../src/rules/definitions/payloads";
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
} from "../../src/domain/product/product";
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
    retrievedAt: id("2026-01-01T00:00:00Z"),
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
    Pick<RuleRevision, "verificationStatus" | "precedence" | "validFrom" | "validUntil" | "publicationStatus" | "verification">
  > = {},
): RuleRevision {
  ruleCounter += 1;
  const verificationStatus: VerificationStatus = options.verificationStatus ?? "CONFIRMED";
  const resolved = verificationStatus === "CONFIRMED" || verificationStatus === "STRONG_EVIDENCE";
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
    payload,
    precedence: options.precedence ?? [],
    evidence: resolved ? [{ sourceRevisionId: id(TEST_SOURCE_REVISION_ID), citationDetail: "synthetic" }] : [],
    verification:
      options.verification ??
      (resolved ? null : { code: "CASE_CLASSIFICATION_UNCONFIRMED", targetKind: "CASE" }),
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
    prepareEngineReadyBundle(bundleContent(rules, extras), effectiveLocalDate as LocalDate),
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

export function firstCedulaPolicy(): ProductPolicyRevision {
  return {
    productPolicyRevisionId: id(testUuid(7999)),
    productPolicyId: id("synthetic.policy.mvp"),
    publicationStatus: "PUBLISHED",
    validFrom: "2000-01-01" as LocalDate,
    validUntil: null,
    supportedDesiredProcedures: ["FIRST_CEDULA"],
  };
}

export function pathway(
  pathwayId: string,
  appliesToCaseTypes: readonly string[],
  sections: PathwayDefinitionRevision["sections"] = [],
): PathwayDefinitionRevision {
  ruleCounter += 1;
  return {
    pathwayDefinitionRevisionId: id(testUuid(8000 + ruleCounter)),
    pathwayDefinitionId: id(`synthetic.pathway.${pathwayId}`),
    pathwayId: id(pathwayId),
    publicationStatus: "PUBLISHED",
    validFrom: "2000-01-01" as LocalDate,
    validUntil: null,
    appliesToCaseTypes,
    sections,
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
