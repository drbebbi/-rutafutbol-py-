import { beforeEach, describe, expect, it } from "vitest";
import { country, userCaseFacts } from "../fixtures/facts";
import {
  anyCase,
  firstCedulaPolicy,
  pathway,
  resetRuleCounter,
  rule,
  supportedCoverage,
} from "../fixtures/rules";
import { caseTypePayload } from "../fixtures/payloads";
import { expectErr, expectOk, runEngine } from "../fixtures/engine";
import { PRODUCT_POLICY_EFFECT_KINDS } from "../../src/domain/product/product";

/**
 * The product policy is a gate, not a source of law.
 *
 * These tests pin the two properties that keep it that way: everything a
 * policy can do is in a closed effect union that has no shape for a procedure,
 * a document, a formality or a fee; and the coverage states that mean "not
 * fully served" must be governed by an explicit policy rather than falling
 * through a default.
 */
const pathways = [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])];
const caseTypeRule = () => rule("r.ct", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));

beforeEach(() => {
  resetRuleCounter();
});

describe("product policy gate", () => {
  it("has a closed effect vocabulary that cannot state a legal requirement", () => {
    expect([...PRODUCT_POLICY_EFFECT_KINDS].sort()).toEqual([
      "BLOCKING",
      "UNSUPPORTED",
      "VERIFICATION_REQUIRED",
      "WARNING",
    ]);
  });

  it("refuses to evaluate a partial-coverage case with no policy governing it", () => {
    const error = expectErr(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [firstCedulaPolicy([])],
        productCoverageRevisions: [supportedCoverage("DE", "PARTIAL")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(error.code).toBe("PRODUCT_POLICY_MISSING");
  });

  it("refuses to evaluate an unresearched case with no policy governing it", () => {
    const error = expectErr(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [firstCedulaPolicy([])],
        productCoverageRevisions: [],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(error.code).toBe("PRODUCT_POLICY_MISSING");
  });

  it("refuses to evaluate when nothing declares what the product serves", () => {
    const error = expectErr(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [],
        productCoverageRevisions: [supportedCoverage("DE")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(error.code).toBe("PRODUCT_POLICY_MISSING");
  });

  it("carries the policy revision and clause that produced each effect", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [firstCedulaPolicy()],
        productCoverageRevisions: [supportedCoverage("DE", "PARTIAL")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(decision.productAssessment.effects).toHaveLength(1);
    const applied = decision.productAssessment.effects[0];
    expect(applied?.effect).toEqual({ kind: "WARNING", code: "PARTIAL_COVERAGE" });
    expect(applied?.provenance.policyRuleKey).toBe("partial-coverage-warning");
    expect(String(applied?.provenance.productPolicyId)).toBe("synthetic.policy.mvp");
    expect(decision.warnings.map((warning) => warning.code)).toContain("PRODUCT_SCOPE_PARTIAL");
  });

  it("carries the coverage revision that decided the coverage state", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [firstCedulaPolicy()],
        productCoverageRevisions: [supportedCoverage("DE")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(decision.productAssessment.coverage.state).toBe("SUPPORTED");
    expect(decision.productAssessment.coverage.provenance).toHaveLength(1);
    expect(String(decision.productAssessment.coverage.provenance[0]?.productCoverageId)).toBe(
      "synthetic.coverage.de",
    );
  });

  it("lets a policy decline a case without touching any legal statement", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [
          firstCedulaPolicy([
            {
              policyRuleKey: "decline-de",
              condition: { ...anyCase(), countries: [country("DE")] },
              effect: { kind: "UNSUPPORTED", blocker: "COUNTRY_OUT_OF_SCOPE" },
            },
          ]),
        ],
        productCoverageRevisions: [supportedCoverage("DE")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(decision.caseClassification.status).toBe("UNSUPPORTED");
    // The legal classification the rules produced is untouched: the product
    // declined to serve the case, it did not decide the law differently.
    expect(decision.caseClassification.caseType).toBe("STANDARD_FIRST_CEDULA_FROM_NONE");
  });

  it("lets a policy ask the applicant a question from the closed registry", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [
          firstCedulaPolicy([
            {
              policyRuleKey: "need-entry-evidence",
              condition: { ...anyCase(), caseTypes: ["STANDARD_FIRST_CEDULA_FROM_NONE"] },
              effect: { kind: "BLOCKING", code: "ENTRY_EVIDENCE_REQUIRED" },
            },
          ]),
        ],
        productCoverageRevisions: [supportedCoverage("DE")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(decision.caseClassification.status).toBe("NEEDS_USER_INFORMATION");
    expect(decision.blockingIssues).toEqual([
      { code: "ENTRY_EVIDENCE_REQUIRED", blockedSlotFamily: "PRODUCT_POLICY" },
    ]);
  });

  it("ignores a policy rule whose condition does not match", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        productPolicyRevisions: [
          firstCedulaPolicy([
            {
              policyRuleKey: "other-country",
              condition: { ...anyCase(), countries: [country("FR")] },
              effect: { kind: "UNSUPPORTED", blocker: "COUNTRY_OUT_OF_SCOPE" },
            },
          ]),
        ],
        productCoverageRevisions: [supportedCoverage("DE")],
        pathwayDefinitionRevisions: pathways,
      }),
    );
    expect(decision.productAssessment.effects).toEqual([]);
    expect(decision.caseClassification.status).toBe("COMPLETE");
  });
});
