import { beforeEach, describe, expect, it } from "vitest";
import {
  assertApprovalStillValid,
  validatePublicationCandidate,
  type SafetyCorpusCase,
} from "../../src/application/rules/publication-validation-service";
import { bundleContent, firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import { caseTypePayload, procedurePayload } from "../fixtures/payloads";
import { userCaseFacts } from "../fixtures/facts";
import { DEFAULT_INSTANT } from "../fixtures/engine";
import { evaluationBundleContentHash } from "../../src/rules/bundle/canonical-bundle";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { id } from "../fixtures/ids";

const on = "2026-06-15" as LocalDate;

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [
    pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE", "STANDARD_FIRST_CEDULA_FROM_TEMPORAL"]),
  ],
};

const corpus: readonly SafetyCorpusCase[] = [
  { caseId: "corpus-001", facts: userCaseFacts(), evaluatedAt: DEFAULT_INSTANT },
];

beforeEach(() => {
  resetRuleCounter();
});

describe("publication validation", () => {
  it("does not run a test runner: it validates and measures impact directly", () => {
    resetRuleCounter();
    const baseline = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], extras);
    resetRuleCounter();
    const candidate = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], extras);

    const report = validatePublicationCandidate(candidate, baseline, corpus, on);
    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }
    expect(report.value.totalCases).toBe(1);
    expect(report.value.unchanged).toBe(1);
    expect(report.value.changed).toBe(0);
    expect(report.value.candidateBundleHash).toBe(evaluationBundleContentHash(candidate));
  });

  it("reports a changed decision", () => {
    resetRuleCounter();
    const baseline = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], extras);
    resetRuleCounter();
    const candidate = bundleContent(
      [
        rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
        rule("r.proc", procedurePayload("syn.new-procedure")),
      ],
      extras,
    );
    const report = validatePublicationCandidate(candidate, baseline, corpus, on);
    expect(report.ok && report.value.changed).toBe(1);
    expect(report.ok && report.value.perCase[0]?.impact).toBe("CHANGED");
  });

  it("reports a candidate that newly breaks a corpus case", () => {
    resetRuleCounter();
    const baseline = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], extras);
    resetRuleCounter();
    const candidate = bundleContent(
      [
        rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
        // Two confirmed rules disagreeing with no precedence: an engine error.
        rule("r.a", procedurePayload("syn.p", "REQUIRED")),
        rule("r.b", procedurePayload("syn.p", "NOT_REQUIRED")),
      ],
      extras,
    );
    const report = validatePublicationCandidate(candidate, baseline, corpus, on);
    expect(report.ok && report.value.newlyFailing).toBe(1);
  });

  it("refuses a candidate whose rules do not satisfy the schema", () => {
    resetRuleCounter();
    const revision = rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
    const broken = { ...revision, payload: { family: "NOT_A_FAMILY" } } as unknown as typeof revision;
    const report = validatePublicationCandidate(bundleContent([broken], extras), bundleContent([], extras), corpus, on);
    expect(!report.ok && report.error.kind).toBe("SCHEMA");
  });

  it("refuses a candidate whose precedence graph has a cycle", () => {
    resetRuleCounter();
    const candidate = bundleContent(
      [
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), {
          precedence: [{ relation: "OVERRIDES", overRuleId: id("r.b") }],
        }),
        rule("r.b", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_TEMPORAL"), {
          precedence: [{ relation: "OVERRIDES", overRuleId: id("r.a") }],
        }),
      ],
      extras,
    );
    const report = validatePublicationCandidate(candidate, bundleContent([], extras), corpus, on);
    expect(!report.ok && report.error.kind).toBe("BUNDLE");
  });
});

describe("publication approval binding", () => {
  it("accepts a candidate that has not moved since approval", () => {
    resetRuleCounter();
    const candidate = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], extras);
    const approval = {
      approvedCandidateBundleHash: evaluationBundleContentHash(candidate),
      approvedBy: "publisher",
      approvedAt: DEFAULT_INSTANT,
    };
    expect(assertApprovalStillValid(approval, candidate).ok).toBe(true);
  });

  it("refuses a candidate that changed after approval", () => {
    resetRuleCounter();
    const approved = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], extras);
    const approval = {
      approvedCandidateBundleHash: evaluationBundleContentHash(approved),
      approvedBy: "publisher",
      approvedAt: DEFAULT_INSTANT,
    };
    resetRuleCounter();
    const moved = bundleContent([rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_TEMPORAL"))], extras);
    const result = assertApprovalStillValid(approval, moved);
    expect(!result.ok && result.error.kind).toBe("STALE_PUBLICATION_VALIDATION");
  });
});
