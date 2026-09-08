import { describe, expect, it } from "vitest";
import {
  allowedAccessDomainsForFamily,
  DECISION_SLOT_FAMILIES,
  decisionSlotFamilyForPayload,
  RULE_FAMILIES,
  type RulePayload,
} from "../../src/rules/definitions/payloads";
import { RULE_SCOPES, allowedPathScopesFor } from "../../src/rules/definitions/scopes";
import { RULE_CONDITION_NODE_KINDS, COMPARE_OPERATORS, DATE_COMPARE_OPERATORS, TRUTH_VALUES } from "../../src/rules/definitions/ast";
import { BUNDLE_ELIGIBLE_PUBLICATION_STATUSES, isBundleEligible, PUBLICATION_STATUSES } from "../../src/domain/rules/publication";
import {
  isSupportLevel,
  mergeSupport,
  unresolvedReasonFor,
  VERIFICATION_STATUSES,
} from "../../src/domain/rules/verification";
import { canonicalizeBundleContent } from "../../src/rules/bundle/canonical-bundle";
import { bundleContent, feeIndexRevision, firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage, testSourceRevision } from "../fixtures/rules";
import {
  caseTypePayload,
  dependencyPayload,
  documentPayload,
  feePayload,
  formalityPayload,
  procedurePayload,
  residencePayload,
  reusePayload,
  visaPayload,
  warningPayload,
} from "../fixtures/payloads";
import { alwaysTrue } from "../fixtures/rules";
import { id } from "../fixtures/ids";

const payloads: Readonly<Record<string, RulePayload>> = {
  CLASSIFICATION_CASE_TYPE: caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"),
  CLASSIFICATION_RESIDENCE: residencePayload("TEMPORAL"),
  VISA: visaPayload("syn.purpose", "REQUIRED"),
  PROCEDURE: procedurePayload("syn.p"),
  DOCUMENT_REQUIREMENT: documentPayload("syn.p", "syn.d"),
  DOCUMENT_FORMALITY: formalityPayload("syn.p", "syn.d", "syn.f"),
  DOCUMENT_REUSE: reusePayload("syn.p", "syn.d", "REUSABLE_CONFIRMED"),
  DEPENDENCY: dependencyPayload("syn.a", "syn.b"),
  FEE: feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 1, currency: id("PYG") } }),
  WARNING: warningPayload("FEE_MAY_CHANGE"),
  SPECIAL_CASE: {
    family: "SPECIAL_CASE",
    scope: "CASE",
    condition: alwaysTrue,
    precedence: [],
    resolution: { state: "RESOLVED", consequence: { specialCaseCode: "PARAGUAYAN_SPOUSE" } },
  },
  TIMELINE: {
    family: "TIMELINE",
    scope: "CASE",
    condition: alwaysTrue,
    precedence: [],
    resolution: {
      state: "RESOLVED",
      consequence: { code: "PROCESSING_TIME_INDICATION", severity: "INFO", qualifier: null },
    },
  },
};

describe("rule taxonomy", () => {
  it("maps every payload family onto a decision slot family", () => {
    const seen = new Set<string>();
    for (const [label, payload] of Object.entries(payloads)) {
      const family = decisionSlotFamilyForPayload(payload);
      expect(DECISION_SLOT_FAMILIES, label).toContain(family);
      seen.add(payload.family);
    }
    expect([...seen].sort()).toEqual([...RULE_FAMILIES].sort());
  });

  it("routes classification consequences to the right slot", () => {
    expect(decisionSlotFamilyForPayload(payloads["CLASSIFICATION_CASE_TYPE"] as RulePayload)).toBe("CASE_TYPE");
    expect(decisionSlotFamilyForPayload(payloads["CLASSIFICATION_RESIDENCE"] as RulePayload)).toBe(
      "RESIDENCE_CLASSIFICATION",
    );
    expect(decisionSlotFamilyForPayload(payloads["SPECIAL_CASE"] as RulePayload)).toBe("CASE_TYPE");
    expect(decisionSlotFamilyForPayload(payloads["TIMELINE"] as RulePayload)).toBe("WARNING");
  });

  it("declares an access domain set for every family", () => {
    for (const family of RULE_FAMILIES) {
      const domains = allowedAccessDomainsForFamily(family);
      expect(domains.length, family).toBeGreaterThan(0);
      expect(domains, family).toContain("CASE_LEGAL");
    }
    expect(allowedAccessDomainsForFamily("DOCUMENT_REUSE")).toEqual(["CASE_LEGAL", "DOCUMENT_STATE"]);
    expect(allowedAccessDomainsForFamily("TIMELINE")).toEqual([
      "CASE_LEGAL",
      "DOCUMENT_STATE",
      "ENTRY_READINESS",
    ]);
  });

  it("declares readable path scopes for every rule scope", () => {
    for (const scope of RULE_SCOPES) {
      expect(allowedPathScopesFor(scope).length, scope).toBeGreaterThan(0);
    }
    expect(allowedPathScopesFor("EACH_DOCUMENT_INSTANCE")).toContain("DOCUMENT");
    expect(allowedPathScopesFor("EACH_NATIONALITY")).toContain("NATIONALITY");
    expect(allowedPathScopesFor("EACH_RESIDENCE_HISTORY_ENTRY")).toContain("RESIDENCE_HISTORY");
  });

  it("keeps the AST closed", () => {
    expect(RULE_CONDITION_NODE_KINDS).toEqual([
      "CONSTANT",
      "ALL",
      "ANY",
      "NOT",
      "FACT_STATE",
      "COMPARE",
      "DATE_COMPARE",
      "INTERVAL_OVERLAP_AT_LEAST",
    ]);
    expect(TRUTH_VALUES).toEqual(["TRUE", "FALSE", "INDETERMINATE"]);
    expect(COMPARE_OPERATORS).toHaveLength(9);
    expect(DATE_COMPARE_OPERATORS).toHaveLength(5);
  });
});

describe("publication and verification vocabularies", () => {
  it("makes published and superseded revisions eligible and nothing else", () => {
    expect(BUNDLE_ELIGIBLE_PUBLICATION_STATUSES).toEqual(["PUBLISHED", "SUPERSEDED"]);
    for (const status of PUBLICATION_STATUSES) {
      expect(isBundleEligible(status), status).toBe(status === "PUBLISHED" || status === "SUPERSEDED");
    }
  });

  it("has no OUTDATED verification status", () => {
    expect(VERIFICATION_STATUSES).not.toContain("OUTDATED");
    expect(VERIFICATION_STATUSES).toHaveLength(5);
  });

  it("separates support levels from unresolved reasons", () => {
    for (const status of VERIFICATION_STATUSES) {
      const support = isSupportLevel(status);
      const reason = unresolvedReasonFor(status);
      expect(support === (reason === null), status).toBe(true);
    }
  });

  it("promotes merged support to CONFIRMED only when something confirms it", () => {
    expect(mergeSupport("STRONG_EVIDENCE", "STRONG_EVIDENCE")).toBe("STRONG_EVIDENCE");
    expect(mergeSupport("STRONG_EVIDENCE", "CONFIRMED")).toBe("CONFIRMED");
    expect(mergeSupport("CONFIRMED", "STRONG_EVIDENCE")).toBe("CONFIRMED");
    expect(mergeSupport("CONFIRMED", "CONFIRMED")).toBe("CONFIRMED");
  });
});

describe("bundle canonicalisation", () => {
  it("sorts every collection by its stable identity", () => {
    resetRuleCounter();
    const content = bundleContent(
      [rule("r.b", procedurePayload("syn.b")), rule("r.a", procedurePayload("syn.a"))],
      {
        evidence: [testSourceRevision()],
        feeIndexRevisions: [feeIndexRevision("syn.z", 1), feeIndexRevision("syn.a", 2)],
        productPolicyRevisions: [firstCedulaPolicy()],
        productCoverageRevisions: [supportedCoverage("FR"), supportedCoverage("DE")],
        pathwayDefinitionRevisions: [pathway("b", []), pathway("a", [])],
      },
    );
    const canonical = canonicalizeBundleContent(content);
    const sorted = <T>(items: readonly T[], key: (item: T) => string): boolean =>
      items.map(key).every((value, index, all) => index === 0 || (all[index - 1] as string) <= value);

    expect(sorted(canonical.ruleRevisions, (r) => r.ruleRevisionId as string)).toBe(true);
    expect(sorted(canonical.feeIndexRevisions, (r) => r.feeIndexRevisionId as string)).toBe(true);
    expect(sorted(canonical.productCoverageRevisions, (r) => r.productCoverageRevisionId as string)).toBe(true);
    expect(sorted(canonical.pathwayDefinitionRevisions, (r) => r.pathwayDefinitionRevisionId as string)).toBe(true);
    expect(sorted(canonical.evidence, (r) => r.sourceRevisionId as string)).toBe(true);
    expect(sorted(canonical.ruleSetRevisions, (r) => r.ruleSetRevisionId as string)).toBe(true);
  });
});
