import { beforeEach, describe, expect, it } from "vitest";
import { expectOk, runEngine } from "../fixtures/engine";
import {
  bundleContent,
  feeIndexRevision,
  firstCedulaPolicy,
  pathway,
  resetRuleCounter,
  rule,
  supportedCoverage,
  testSourceRevision,
  testRuleSetRevision,
} from "../fixtures/rules";
import {
  caseTypePayload,
  dependencyPayload,
  documentPayload,
  feePayload,
  formalityPayload,
  procedurePayload,
  reusePayload,
  visaPayload,
  warningPayload,
} from "../fixtures/payloads";
import { userCaseFacts } from "../fixtures/facts";
import { canonicalizeBundleContent, evaluationBundleContentHash } from "../../src/rules/bundle/canonical-bundle";
import { canonicalVerificationFlags } from "../../src/case-engine/verification/flags";
import { id, testUuid } from "../fixtures/ids";
import type { VerificationFlag } from "../../src/domain/evaluation/issues";
import type { EvaluationBundleContent } from "../../src/rules/bundle/bundle-content";

const extras = {
  feeIndexRevisions: [feeIndexRevision("syn.jornal", 1000)],
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

beforeEach(() => {
  resetRuleCounter();
});

/**
 * One rich decision with at least two of everything, so that every canonical
 * comparator actually runs. A comparator that never executes is a comparator
 * nobody has proved deterministic.
 */
describe("canonical output ordering", () => {
  const rules = () => [
    rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
    rule("r.zeta", procedurePayload("syn.zeta")),
    rule("r.alpha", procedurePayload("syn.alpha")),
    rule("r.dep1", dependencyPayload("syn.zeta", "syn.alpha")),
    rule("r.doc-b", documentPayload("syn.zeta", "syn.b-doc")),
    rule("r.doc-a", documentPayload("syn.alpha", "syn.a-doc")),
    rule("r.formality-b", formalityPayload("syn.alpha", "syn.a-doc", "syn.zeta-formality")),
    rule("r.formality-a", formalityPayload("syn.alpha", "syn.a-doc", "syn.alpha-formality")),
    rule("r.reuse-a", reusePayload("syn.alpha", "syn.a-doc", "REUSABLE_CONFIRMED")),
    rule("r.reuse-b", reusePayload("syn.zeta", "syn.b-doc", "REISSUE_REQUIRED")),
    rule("r.fee-z", feePayload("syn.zeta", "syn.official", { kind: "INDEXED", multiplier: 3, feeIndexId: id("syn.jornal") })),
    rule("r.fee-a", feePayload("syn.alpha", "syn.official", { kind: "FIXED", amount: { amountMinorUnits: 8500, currency: id("PYG") } })),
    rule("r.visa-b", visaPayload("syn.zeta-purpose", "NOT_REQUIRED")),
    rule("r.visa-a", visaPayload("syn.alpha-purpose", "REQUIRED")),
    rule("r.warn-b", warningPayload("PROCESSING_TIME_INDICATION", "INFO", "b")),
    rule("r.warn-a", warningPayload("FEE_MAY_CHANGE", "INFO", "a")),
  ];

  const ascending = <T>(items: readonly T[], key: (item: T) => string): boolean =>
    items.map(key).every((value, index, all) => index === 0 || (all[index - 1] as string) <= value);

  it("emits every array in canonical order", () => {
    const decision = expectOk(runEngine(userCaseFacts(), rules(), extras));

    expect(decision.requiredProcedures.length).toBeGreaterThan(1);
    expect(decision.requiredDocuments.length).toBeGreaterThan(1);
    expect(decision.feeCalculations.length).toBeGreaterThan(1);
    expect(decision.warnings.length).toBeGreaterThan(1);
    expect(decision.modifiers.length).toBeGreaterThan(1);
    expect(decision.documentReuseAssessments.length).toBeGreaterThan(1);
    expect(decision.requiredDocuments.some((document) => document.formalities.length > 1)).toBe(true);

    expect(ascending(decision.requiredProcedures, (item) => item.key as string)).toBe(true);
    expect(ascending(decision.requiredDocuments, (item) => item.key as string)).toBe(true);
    expect(ascending(decision.documentReuseAssessments, (item) => item.documentKey as string)).toBe(true);
    expect(ascending(decision.feeCalculations, (item) => `${item.forProcedure as string}:${item.componentCode as string}`)).toBe(true);
    expect(ascending(decision.warnings, (item) => `${item.code}|${item.qualifier ?? "-"}`)).toBe(true);
    expect(ascending(decision.modifiers, (item) => `${item.code}|${item.qualifier ?? "-"}`)).toBe(true);
    for (const document of decision.requiredDocuments) {
      expect(ascending(document.formalities, (item) => item.formalityCode as string)).toBe(true);
    }
  });

  it("produces the same decision however the rules were ordered", () => {
    const forward = expectOk(runEngine(userCaseFacts(), rules(), extras));
    resetRuleCounter();
    const reversed = expectOk(runEngine(userCaseFacts(), [...rules()].reverse(), extras));
    expect(reversed).toEqual(forward);
  });

  it("orders dependencies by dependent then prerequisite", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("syn.a")),
          rule("r.b", procedurePayload("syn.b")),
          rule("r.c", procedurePayload("syn.c")),
          rule("r.dep1", dependencyPayload("syn.c", "syn.b")),
          rule("r.dep2", dependencyPayload("syn.c", "syn.a")),
          rule("r.dep3", dependencyPayload("syn.b", "syn.a")),
        ],
        extras,
      ),
    );
    expect(decision.procedureDependencies).toHaveLength(3);
    expect(
      ascending(decision.procedureDependencies, (item) => `${item.dependent as string}|${item.dependsOn as string}`),
    ).toBe(true);
  });
});

describe("canonical bundle collections", () => {
  it("sorts collections that hold more than one entry", () => {
    resetRuleCounter();
    const content = bundleContent(
      [rule("r.b", procedurePayload("syn.b")), rule("r.a", procedurePayload("syn.a"))],
      {
        evidence: [
          { ...testSourceRevision(), sourceRevisionId: id(testUuid(9101)) },
          { ...testSourceRevision(), sourceRevisionId: id(testUuid(9100)) },
        ],
        feeIndexRevisions: [feeIndexRevision("syn.z", 1), feeIndexRevision("syn.a", 2)],
        productPolicyRevisions: [
          { ...firstCedulaPolicy(), productPolicyRevisionId: id(testUuid(9201)) },
          { ...firstCedulaPolicy(), productPolicyRevisionId: id(testUuid(9200)) },
        ],
        productCoverageRevisions: [supportedCoverage("FR"), supportedCoverage("DE")],
        pathwayDefinitionRevisions: [pathway("b", []), pathway("a", [])],
      },
    );
    const withTwoRuleSets: EvaluationBundleContent = {
      ...content,
      ruleSetRevisions: [
        { ...testRuleSetRevision(), ruleSetRevisionId: id(testUuid(9301)) },
        { ...testRuleSetRevision(), ruleSetRevisionId: id(testUuid(9300)) },
      ],
    };
    const canonical = canonicalizeBundleContent(withTwoRuleSets);
    const ascending = <T>(items: readonly T[], key: (item: T) => string): boolean =>
      items.map(key).every((value, index, all) => index === 0 || (all[index - 1] as string) <= value);

    expect(ascending(canonical.ruleSetRevisions, (r) => r.ruleSetRevisionId as string)).toBe(true);
    expect(ascending(canonical.evidence, (r) => r.sourceRevisionId as string)).toBe(true);
    expect(ascending(canonical.productPolicyRevisions, (r) => r.productPolicyRevisionId as string)).toBe(true);
    expect(evaluationBundleContentHash(withTwoRuleSets)).toBe(
      evaluationBundleContentHash({
        ...withTwoRuleSets,
        ruleSetRevisions: [...withTwoRuleSets.ruleSetRevisions].reverse(),
        evidence: [...withTwoRuleSets.evidence].reverse(),
      }),
    );
  });
});

describe("verification flag ordering", () => {
  it("sorts distinct flags canonically", () => {
    const flags: readonly VerificationFlag[] = [
      { code: "FEE_AMOUNT_UNCONFIRMED", target: { kind: "CASE" }, reason: "UNKNOWN", provenance: [] },
      { code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "CASE" }, reason: "UNKNOWN", provenance: [] },
    ];
    const canonical = canonicalVerificationFlags(flags);
    expect(canonical.map((flag) => flag.code)).toEqual([
      "CASE_CLASSIFICATION_UNCONFIRMED",
      "FEE_AMOUNT_UNCONFIRMED",
    ]);
  });
});
