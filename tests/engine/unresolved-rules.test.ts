import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import {
  anyCase,
  firstCedulaPolicy,
  pathway,
  resetRuleCounter,
  rule,
  supportedCoverage,
} from "../fixtures/rules";
import {
  caseTypePayload,
  dependencyPayload,
  documentPayload,
  feePayload,
  formalityPayload,
  procedurePayload,
  residencePayload,
  reusePayload,
  unresolved,
  visaPayload,
  warningPayload,
} from "../fixtures/payloads";
import { expectOk, runEngine } from "../fixtures/engine";
import { bundleContent } from "../fixtures/rules";
import { prepareEngineReadyBundle } from "../../src/rules/bundle/engine-ready-bundle";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { id } from "../fixtures/ids";
import type { PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION } from "../../src/domain/product/product";
import type { PrecedenceEdge } from "../../src/rules/definitions/payloads";
import type { RuleId } from "../../src/domain/identifiers/identifiers";

/**
 * An unresolved rule of any family contributes no consequence.
 *
 * One case per family, because the guard that keeps a consequence-less rule
 * out of a decision slot lives in each stage: a family that forgot it would
 * read `undefined` as a consequence and decide something.
 */
const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

const caseTypeRule = () => rule("r.ct", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
const askAboutCase = { code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "CASE" } } as const;

beforeEach(() => {
  resetRuleCounter();
});

describe("unresolved rules across every family", () => {
  it("does not classify a case type", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.ct", unresolved(caseTypePayload("SPECIAL_CASE"), "UNKNOWN", askAboutCase), {
            verificationStatus: "UNKNOWN",
          }),
        ],
        extras,
      ),
    );
    expect(decision.caseClassification.caseType).toBeNull();
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain(
      "CASE_CLASSIFICATION_UNCONFIRMED",
    );
  });

  it("does not classify residence, and puts the status under review", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule(
            "r.res",
            unresolved(residencePayload("PERMANENT"), "CONFLICTING", {
              code: "RESIDENCE_CLASSIFICATION_UNCONFIRMED",
              target: { kind: "CASE" },
            }),
            { verificationStatus: "CONFLICTING" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.residenceClassification).toEqual({
      state: "STATUS_REVIEW_REQUIRED",
      classification: null,
    });
  });

  it("does not decide a visa requirement", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule(
            "r.visa",
            unresolved(visaPayload("syn.purpose", "REQUIRED"), "UNKNOWN", {
              code: "VISA_REQUIREMENT_UNCONFIRMED",
              target: { kind: "VISA_PURPOSE", purposeCode: id("syn.purpose") },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.modifiers.map((modifier) => modifier.code)).not.toContain("VISA_REQUIRED");
  });

  it("does not require a procedure", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", unresolved(procedurePayload("syn.p"), "UNKNOWN", askAboutCase), {
            verificationStatus: "UNKNOWN",
          }),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toEqual([]);
  });

  it("does not require a document", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", unresolved(documentPayload("syn.p", "syn.d"), "UNKNOWN", askAboutCase), {
            verificationStatus: "UNKNOWN",
          }),
        ],
        extras,
      ),
    );
    expect(decision.requiredDocuments).toEqual([]);
  });

  it("does not require a formality", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
          rule(
            "r.formality",
            unresolved(formalityPayload("syn.p", "syn.d", "syn.apostille"), "UNKNOWN", askAboutCase),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.requiredDocuments[0]?.formalities).toEqual([]);
  });

  it("leaves document reuse unknown rather than deciding it", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
          rule(
            "r.reuse",
            unresolved(reusePayload("syn.p", "syn.d", "REUSABLE_CONFIRMED"), "UNKNOWN", askAboutCase),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.documentReuseAssessments[0]?.resolution).toBe("REUSE_UNKNOWN");
  });

  it("does not create a procedure dependency", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.a", procedurePayload("syn.a")),
          rule("r.b", procedurePayload("syn.b")),
          rule("r.dep", unresolved(dependencyPayload("syn.b", "syn.a"), "UNKNOWN", askAboutCase), {
            verificationStatus: "UNKNOWN",
          }),
        ],
        extras,
      ),
    );
    expect(decision.procedureDependencies).toEqual([]);
  });

  it("does not calculate a fee", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule(
            "r.fee",
            unresolved(
              feePayload("syn.p", "syn.c", {
                kind: "FIXED",
                amount: { amountMinorUnits: 100, currency: id("PYG") },
              }),
              "UNKNOWN",
              askAboutCase,
            ),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.feeCalculations).toEqual([]);
    expect(decision.costEstimate.confirmedOfficial).toEqual([]);
  });

  it("does not raise a warning", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.w", unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", askAboutCase), {
            verificationStatus: "UNKNOWN",
          }),
        ],
        extras,
      ),
    );
    expect(decision.warnings.map((warning) => warning.code)).not.toContain("FEE_MAY_CHANGE");
  });

  it("blocks on a fact an indeterminate unresolved rule still depends on", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts({ maritalStatus: { state: "UNANSWERED" } }),
        [
          caseTypeRule(),
          rule(
            "r.maybe",
            unresolved(
              procedurePayload("syn.p", "REQUIRED", {
                kind: "COMPARE",
                path: "case.maritalStatus",
                operator: "EQ",
                operand: { kind: "STRING", value: "MARRIED" },
              }),
              "UNKNOWN",
              askAboutCase,
            ),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });
});

describe("product policy gate, remaining paths", () => {
  it("refuses a policy whose payload schema this engine does not support", () => {
    const policy = firstCedulaPolicy();
    const prepared = prepareEngineReadyBundle(
      bundleContent([caseTypeRule()], {
        ...extras,
        productPolicyRevisions: [
          {
            ...policy,
            payloadSchemaVersion: "product-policy@9.9" as typeof PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION,
          },
        ],
      }),
      "2026-06-15" as LocalDate,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    // Caught while the bundle is prepared, before any policy is consulted: the
    // engine descriptor lists the versions this build can interpret.
    expect(prepared.ok).toBe(false);
    expect(!prepared.ok && prepared.error.map((issue) => (issue.kind === "BUNDLE" ? issue.code : issue.kind))).toEqual([
      "UNSUPPORTED_PRODUCT_POLICY_VERSION",
    ]);
  });

  it("narrows a policy rule by desired procedure", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        ...extras,
        productPolicyRevisions: [
          firstCedulaPolicy([
            {
              policyRuleKey: "renewals-only",
              condition: { ...anyCase(), desiredProcedures: ["CEDULA_RENEWAL"] },
              effect: { kind: "UNSUPPORTED", blocker: "PROCEDURE_OUT_OF_SCOPE" },
            },
          ]),
        ],
      }),
    );
    expect(decision.productAssessment.effects).toEqual([]);
    expect(decision.caseClassification.status).toBe("COMPLETE");
  });

  it("narrows a policy rule by coverage state", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        ...extras,
        productPolicyRevisions: [
          firstCedulaPolicy([
            {
              policyRuleKey: "supported-note",
              condition: { ...anyCase(), coverageStates: ["SUPPORTED"] },
              effect: { kind: "VERIFICATION_REQUIRED", code: "PRODUCT_COVERAGE_RESEARCH_REQUIRED" },
            },
          ]),
        ],
      }),
    );
    expect(decision.productAssessment.effects).toHaveLength(1);
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
  });
});

/**
 * A confirmed winner silences what it takes precedence over, in every slot.
 *
 * The suppression list is what carries that across to the unresolved track, so
 * each stage has to report it. A stage that forgot would let a rule the
 * decision already beat keep asking a question about it.
 */
describe("precedence suppression reaches the unresolved track from every stage", () => {
  const askFrom = (over: string): Readonly<{ precedence: readonly PrecedenceEdge[] }> => ({
    precedence: [{ relation: "OVERRIDES", overRuleId: id(over) as RuleId }],
  });

  it("silences a special-case rule the case-type winner dominates", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.ct", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), askFrom("r.special")),
          rule("r.special", unresolved(caseTypePayload("SPECIAL_CASE"), "UNKNOWN", askAboutCase), {
            verificationStatus: "UNKNOWN",
          }),
        ],
        extras,
      ),
    );
    expect(decision.caseClassification.caseType).toBe("STANDARD_FIRST_CEDULA_FROM_NONE");
    expect(decision.verificationFlags).toEqual([]);
  });

  it("silences a dominated rule in the document, dependency, fee, reuse and warning slots", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.q", procedurePayload("syn.q")),
          rule("r.doc", documentPayload("syn.p", "syn.d"), askFrom("r.doc.beaten")),
          rule("r.doc.beaten", documentPayload("syn.p", "syn.d", "NOT_REQUIRED")),
          rule("r.formality", formalityPayload("syn.p", "syn.d", "syn.apostille"), askFrom("r.formality.beaten")),
          rule("r.formality.beaten", formalityPayload("syn.p", "syn.d", "syn.apostille", "NOT_REQUIRED")),
          rule("r.reuse", reusePayload("syn.p", "syn.d", "REUSABLE_CONFIRMED"), askFrom("r.reuse.beaten")),
          rule("r.reuse.beaten", reusePayload("syn.p", "syn.d", "REUSE_NOT_ALLOWED")),
          rule("r.dep", dependencyPayload("syn.q", "syn.p"), askFrom("r.dep.beaten")),
          rule("r.dep.beaten", dependencyPayload("syn.q", "syn.p", "NOT_REQUIRED_BEFORE")),
          rule(
            "r.fee",
            feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 100, currency: id("PYG") } }),
            askFrom("r.fee.beaten"),
          ),
          rule(
            "r.fee.beaten",
            feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 900, currency: id("PYG") } }),
          ),
          rule("r.warn", warningPayload("FEE_MAY_CHANGE", "INFO"), askFrom("r.warn.beaten")),
          rule("r.warn.beaten", warningPayload("FEE_MAY_CHANGE", "CAUTION")),
        ],
        extras,
      ),
    );

    // Every slot took the dominating rule, and none of the beaten ones left a
    // trace in the decision.
    expect(decision.requiredDocuments).toHaveLength(1);
    expect(decision.requiredDocuments[0]?.formalities.map((f) => String(f.formalityCode))).toEqual([
      "syn.apostille",
    ]);
    expect(decision.documentReuseAssessments[0]?.resolution).toBe("REUSABLE_CONFIRMED");
    expect(decision.procedureDependencies).toHaveLength(1);
    expect(decision.feeCalculations[0]?.calculatedAmount?.amountMinorUnits).toBe(100);
    expect(decision.warnings.map((warning) => warning.severity)).toEqual(["INFO"]);
  });

  it("silences a dominated visa rule and a dominated residence rule", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.visa", visaPayload("syn.purpose", "REQUIRED"), askFrom("r.visa.beaten")),
          rule("r.visa.beaten", visaPayload("syn.purpose", "NOT_REQUIRED")),
          rule("r.res", residencePayload("NONE"), askFrom("r.res.beaten")),
          rule("r.res.beaten", residencePayload("PERMANENT")),
        ],
        extras,
      ),
    );
    expect(decision.modifiers.map((modifier) => modifier.code)).toContain("VISA_REQUIRED");
    expect(decision.residenceClassification).toEqual({ state: "CLASSIFIED", classification: "NONE" });
  });
});
