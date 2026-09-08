import { beforeEach, describe, expect, it } from "vitest";
import {
  parseWizardAnswers,
  summariseDecision,
  wizardAnswersToFacts,
} from "../../src/application/cases/wizard-mapping";
import { expectOk, runEngine } from "../fixtures/engine";
import { firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import { caseTypePayload, documentPayload, procedurePayload } from "../fixtures/payloads";
import type { CaseEvaluationDecision } from "../../src/domain/evaluation/decision";

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

const answers = (overrides: Partial<Parameters<typeof wizardAnswersToFacts>[0]> = {}) => ({
  citizenship: "DE",
  residence: "NONE" as const,
  holdsPreviousCedula: false,
  paraguayanSpouse: false,
  ...overrides,
});

beforeEach(() => {
  resetRuleCounter();
});

describe("wizard answer parsing", () => {
  it("accepts a well-formed body and defaults the optional flags", () => {
    const parsed = parseWizardAnswers({ citizenship: "DE", residence: "NONE" });
    expect(parsed.ok && parsed.value.holdsPreviousCedula).toBe(false);
    expect(parsed.ok && parsed.value.paraguayanSpouse).toBe(false);
  });

  it("rejects a malformed body without leaking why", () => {
    for (const body of [null, {}, { citizenship: "germany" }, { citizenship: "DE", residence: "MAYBE" }]) {
      const parsed = parseWizardAnswers(body);
      expect(parsed.ok, JSON.stringify(body)).toBe(false);
      expect(!parsed.ok && parsed.error).toBe("malformed request");
    }
  });
});

describe("mapping answers onto facts", () => {
  it("keeps 'I do not know' as UNKNOWN all the way into the fact model", () => {
    const facts = wizardAnswersToFacts(answers({ residence: null }));
    expect(facts.classification.residence.reportedType.state).toBe("UNKNOWN");
  });

  it("carries the answered residence through", () => {
    const facts = wizardAnswersToFacts(answers({ residence: "TEMPORAL" }));
    expect(facts.classification.residence.reportedType).toEqual({ state: "KNOWN", value: "TEMPORAL" });
  });

  it("carries the two special-case answers through", () => {
    const facts = wizardAnswersToFacts(answers({ holdsPreviousCedula: true, paraguayanSpouse: true }));
    expect(facts.classification.holdsPreviousParaguayanCedula).toEqual({ state: "KNOWN", value: true });
    expect(facts.classification.specialCase.paraguayanSpouse).toEqual({ state: "KNOWN", value: true });
  });

  it("uses the chosen passport for citizenship and for both travel documents", () => {
    const facts = wizardAnswersToFacts(answers({ citizenship: "IT" }));
    const nationalities = facts.classification.nationalities;
    expect(nationalities.state === "KNOWN" && nationalities.value[0]?.countryCode).toBe("IT");
    expect(facts.classification.processTravelDocumentCountry).toEqual({ state: "KNOWN", value: "IT" });
  });
});

describe("decision summary", () => {
  /**
   * Regression, found by running the app: the engine reports one blocking
   * issue per (code, slot family) pair, so a single unanswered question
   * rendered as the same sentence five times in the browser - and, because the
   * list is keyed by code, as five React children with the same key.
   */
  it("reports each blocking issue code once, however many decisions it holds up", () => {
    const decision = expectOk(
      runEngine(
        wizardAnswersToFacts(answers({ residence: null })),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE", {
            kind: "COMPARE",
            path: "case.residence.reportedType",
            operator: "EQ",
            operand: { kind: "STRING", value: "NONE" },
          })),
          rule("r.p", procedurePayload("syn.p", "REQUIRED", {
            kind: "COMPARE",
            path: "case.residence.reportedType",
            operator: "EQ",
            operand: { kind: "STRING", value: "NONE" },
          })),
        ],
        extras,
      ),
    );

    // The engine itself keeps the slot family, and legitimately repeats a code.
    expect(decision.blockingIssues.length).toBeGreaterThan(1);
    expect(new Set(decision.blockingIssues.map((issue) => issue.code)).size).toBe(1);

    const summary = summariseDecision(decision);
    expect(summary.blockingIssues).toEqual(["RESIDENCE_STATUS_REQUIRED"]);
  });

  it("reports each verification code once and in a stable order", () => {
    const decision: CaseEvaluationDecision = {
      residenceClassification: { state: "UNRESOLVED", classification: null },
      caseClassification: { caseType: null, status: "NEEDS_OFFICIAL_VERIFICATION" },
      applicablePathway: null,
      modifiers: [],
      blockingIssues: [],
      verificationFlags: [
        { code: "FEE_AMOUNT_UNCONFIRMED", target: { kind: "CASE" }, reason: "UNKNOWN", provenance: [] },
        { code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "CASE" }, reason: "UNKNOWN", provenance: [] },
        { code: "FEE_AMOUNT_UNCONFIRMED", target: { kind: "CASE" }, reason: "CONFLICTING", provenance: [] },
      ],
      requiredProcedures: [],
      procedureDependencies: [],
      requiredDocuments: [],
      documentReuseAssessments: [],
      warnings: [],
      feeCalculations: [],
      costEstimate: {
        confirmedOfficial: [],
        indexedOfficial: [],
        unknownOfficialFeeCount: 0,
        externalVariableCostCodes: [],
      },
    };
    expect(summariseDecision(decision).verificationFlags).toEqual([
      "CASE_CLASSIFICATION_UNCONFIRMED",
      "FEE_AMOUNT_UNCONFIRMED",
    ]);
  });

  it("counts procedures and documents rather than describing them", () => {
    const decision = expectOk(
      runEngine(
        wizardAnswersToFacts(answers()),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
        ],
        extras,
      ),
    );
    const summary = summariseDecision(decision);
    expect(summary).toEqual({
      status: "COMPLETE",
      caseType: "STANDARD_FIRST_CEDULA_FROM_NONE",
      requiredProcedureCount: 1,
      requiredDocumentCount: 1,
      blockingIssues: [],
      verificationFlags: [],
    });
  });
});
