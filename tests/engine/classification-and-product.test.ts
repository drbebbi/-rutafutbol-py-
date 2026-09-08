import { beforeEach, describe, expect, it } from "vitest";
import { noSpecialCase, unansweredSpecialCase, userCaseFacts, country } from "../fixtures/facts";
import { firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import {
  caseTypePayload,
  documentPayload,
  procedurePayload,
  residencePayload,
  unresolved,
  visaPayload,
  warningPayload,
} from "../fixtures/payloads";
import { expectOk, runEngine } from "../fixtures/engine";
import { knownFact, unansweredFact, unknownFact } from "../../src/domain/case/knowledge";
import { knownSpecialCaseGuard } from "../../src/case-engine/classify/special-case-guard";
import { PRODUCT_COVERAGE_STATES } from "../../src/domain/product/product";
import { runProductGate, projectProductPolicyFactView } from "../../src/case-engine/classify/product-gate";
import { engineReadyBundle } from "../fixtures/rules";
import { assessCompletion, finalStatus } from "../../src/case-engine/evaluate/completion";

const pathways = [
  pathway("standard", [
    "STANDARD_FIRST_CEDULA_FROM_NONE",
    "STANDARD_FIRST_CEDULA_FROM_TEMPORAL",
    "SPECIAL_CASE",
    "COUNTRY_NOT_SUPPORTED",
    "NOT_FIRST_CEDULA",
  ]),
];

const supported = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: pathways,
};

const caseTypeRule = () => rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));

beforeEach(() => {
  resetRuleCounter();
});

describe("special case guard", () => {
  it("reports CONFIRMED when a signal is answered yes", () => {
    const facts = userCaseFacts({
      specialCase: { ...noSpecialCase, paraguayanSpouse: knownFact(true) },
    });
    expect(knownSpecialCaseGuard(facts)).toEqual({ state: "CONFIRMED", signals: ["PARAGUAYAN_SPOUSE"] });
  });

  it("treats a minor as a special case", () => {
    const facts = userCaseFacts({ adultStatus: knownFact("MINOR") });
    expect(knownSpecialCaseGuard(facts).signals).toContain("MINOR");
  });

  it("reports POSSIBLE_UNANSWERED while any signal is open", () => {
    const facts = userCaseFacts({ specialCase: unansweredSpecialCase });
    expect(knownSpecialCaseGuard(facts).state).toBe("POSSIBLE_UNANSWERED");
  });

  it("reports NONE only when every signal is answered no", () => {
    expect(knownSpecialCaseGuard(userCaseFacts()).state).toBe("NONE");
  });
});

describe("product coverage", () => {
  it("supports a covered country", () => {
    const decision = expectOk(runEngine(userCaseFacts(), [caseTypeRule()], supported));
    expect(decision.caseClassification.status).toBe("COMPLETE");
    expect(decision.caseClassification.caseType).toBe("STANDARD_FIRST_CEDULA_FROM_NONE");
  });

  it("warns on partial coverage", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        ...supported,
        productCoverageRevisions: [supportedCoverage("DE", "PARTIAL")],
      }),
    );
    expect(decision.warnings.map((w) => w.code)).toContain("PRODUCT_SCOPE_PARTIAL");
    expect(decision.caseClassification.status).toBe("COMPLETE_WITH_WARNINGS");
  });

  it("terminates an out-of-scope country only once the special-case signals are answered no", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        ...supported,
        productCoverageRevisions: [supportedCoverage("DE", "NOT_SUPPORTED")],
      }),
    );
    expect(decision.caseClassification.status).toBe("UNSUPPORTED");
    expect(decision.caseClassification.caseType).toBe("COUNTRY_NOT_SUPPORTED");
  });

  it("never terminates an out-of-scope country while a special-case signal is unanswered", () => {
    const facts = userCaseFacts({ specialCase: unansweredSpecialCase });
    const decision = expectOk(
      runEngine(facts, [caseTypeRule()], {
        ...supported,
        productCoverageRevisions: [supportedCoverage("DE", "NOT_SUPPORTED")],
      }),
    );
    expect(decision.caseClassification.status).toBe("NEEDS_USER_INFORMATION");
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("SPECIAL_CASE_ANSWERS_REQUIRED");
    expect(decision.caseClassification.caseType).not.toBe("COUNTRY_NOT_SUPPORTED");
  });

  it("bypasses country scope for a confirmed special case", () => {
    const facts = userCaseFacts({
      specialCase: { ...noSpecialCase, paraguayanCitizenship: knownFact(true) },
    });
    const decision = expectOk(
      runEngine(facts, [], {
        ...supported,
        productCoverageRevisions: [supportedCoverage("DE", "NOT_SUPPORTED")],
      }),
    );
    expect(decision.caseClassification.caseType).toBe("SPECIAL_CASE");
    expect(decision.modifiers.map((m) => m.code)).toContain("PARAGUAYAN_CITIZENSHIP_DECLARED");
  });

  it("asks for research rather than assuming a country is unsupported", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule()], { ...supported, productCoverageRevisions: [] }),
    );
    expect(decision.verificationFlags.map((f) => f.code)).toContain("PRODUCT_COVERAGE_RESEARCH_REQUIRED");
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
  });

  it("cannot decide coverage without knowing which travel document is used", () => {
    const facts = userCaseFacts({
      processTravelDocumentCountry: unansweredFact,
      nationalities: knownFact([
        { countryCode: country("DE"), roles: ["CITIZENSHIP"] },
        { countryCode: country("IT"), roles: ["CITIZENSHIP"] },
      ]),
    });
    const decision = expectOk(runEngine(facts, [caseTypeRule()], supported));
    expect(decision.blockingIssues.map((i) => i.code)).toContain("PROCESS_TRAVEL_DOCUMENT_REQUIRED");
    expect(decision.modifiers.map((m) => m.code)).toContain("MULTIPLE_CITIZENSHIPS");
  });

  it("cannot decide coverage without any nationality", () => {
    const facts = userCaseFacts({ processTravelDocumentCountry: unansweredFact, nationalities: unknownFact });
    const decision = expectOk(runEngine(facts, [caseTypeRule()], supported));
    expect(decision.blockingIssues.map((i) => i.code)).toContain("NATIONALITY_REQUIRED");
  });

  it("falls back to a single citizenship when no process document is named", () => {
    const facts = userCaseFacts({ processTravelDocumentCountry: unansweredFact });
    expect(String(projectProductPolicyFactView(facts).coverageCountry)).toBe("DE");
  });

  it("declares a procedure outside the product's scope unsupported", () => {
    const facts = userCaseFacts({ desiredProcedure: "CEDULA_RENEWAL" });
    const decision = expectOk(runEngine(facts, [caseTypeRule()], supported));
    expect(decision.caseClassification.caseType).toBe("NOT_FIRST_CEDULA");
    expect(decision.caseClassification.status).toBe("UNSUPPORTED");
  });

  it("treats an applicant who already holds a cedula as not a first cedula", () => {
    const facts = userCaseFacts({ holdsPreviousParaguayanCedula: knownFact(true) });
    const decision = expectOk(runEngine(facts, [caseTypeRule()], supported));
    expect(decision.caseClassification.caseType).toBe("NOT_FIRST_CEDULA");
  });

  it("covers every declared coverage state in the product model", () => {
    expect(PRODUCT_COVERAGE_STATES).toEqual([
      "SUPPORTED",
      "PARTIAL",
      "NOT_SUPPORTED",
      "RESEARCH_REQUIRED",
      "INDETERMINATE",
      "BYPASSED_SPECIAL_CASE",
    ]);
  });

  it("reports NOT_SUPPORTED when the policy does not serve the desired procedure at all", () => {
    const facts = userCaseFacts({ desiredProcedure: "CEDULA_REPLACEMENT" });
    const bundle = engineReadyBundle([], "2026-06-15", supported);
    const gate = runProductGate(facts, bundle, knownSpecialCaseGuard(facts));
    expect(gate.assessment.coverageState).toBe("NOT_SUPPORTED");
    expect(gate.assessment.blockers).toEqual(["PROCEDURE_OUT_OF_SCOPE"]);
  });
});

describe("residence classification", () => {
  it("is rule-driven, not derived from what the user reported", () => {
    const decision = expectOk(runEngine(userCaseFacts(), [caseTypeRule()], supported));
    expect(decision.residenceClassification).toEqual({ state: "UNRESOLVED", classification: null });
  });

  it("classifies when a rule says so", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule(), rule("r.res", residencePayload("TEMPORAL"))], supported),
    );
    expect(decision.residenceClassification).toEqual({ state: "CLASSIFIED", classification: "TEMPORAL" });
  });

  it("asks for a status review when the residence rule is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule(
            "r.res",
            unresolved(residencePayload("TEMPORAL"), "CONFLICTING", {
              code: "RESIDENCE_CLASSIFICATION_UNCONFIRMED",
              target: { kind: "CASE" },
            }),
            { verificationStatus: "CONFLICTING" },
          ),
        ],
        supported,
      ),
    );
    expect(decision.residenceClassification.state).toBe("STATUS_REVIEW_REQUIRED");
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
  });

  it("asks the user when the residence rule is indeterminate", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts({ residence: { reportedType: unknownFact, card: { state: knownFact("HELD_VALID"), expiryDate: unknownFact } } }),
        [
          caseTypeRule(),
          rule("r.res", residencePayload("TEMPORAL", {
            kind: "COMPARE",
            path: "case.residence.reportedType",
            operator: "EQ",
            operand: { kind: "STRING", value: "TEMPORAL" },
          })),
        ],
        supported,
      ),
    );
    expect(decision.residenceClassification.state).toBe("CLASSIFICATION_REQUIRED");
    expect(decision.blockingIssues.map((i) => i.code)).toContain("RESIDENCE_STATUS_REQUIRED");
  });
});

describe("case classification invariants", () => {
  it("reports an unclassifiable case rather than inventing a case type", () => {
    const decision = expectOk(runEngine(userCaseFacts(), [], supported));
    expect(decision.caseClassification.caseType).toBeNull();
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
    expect(decision.verificationFlags.map((f) => f.code)).toEqual(["CASE_CLASSIFICATION_UNCONFIRMED"]);
  });

  it("orders the completion assessment deterministically", () => {
    const issue = { code: "ADULT_STATUS_REQUIRED", blockedSlotFamily: "CASE_TYPE" } as const;
    const flag = { code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "CASE" }, reason: "UNKNOWN", provenance: [] } as const;
    expect(assessCompletion(true, [issue], [flag])).toBe("UNSUPPORTED");
    expect(assessCompletion(false, [issue], [flag])).toBe("NEEDS_USER_INFORMATION");
    expect(assessCompletion(false, [], [flag])).toBe("NEEDS_OFFICIAL_VERIFICATION");
    expect(assessCompletion(false, [], [])).toBe("OTHERWISE_COMPLETE");
    expect(finalStatus("OTHERWISE_COMPLETE", false, false)).toBe("COMPLETE");
    expect(finalStatus("OTHERWISE_COMPLETE", true, false)).toBe("COMPLETE_WITH_WARNINGS");
    expect(finalStatus("OTHERWISE_COMPLETE", false, true)).toBe("COMPLETE_WITH_WARNINGS");
  });
});

describe("visa and warnings", () => {
  it("surfaces a visa decision as a modifier with provenance", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [caseTypeRule(), rule("r.visa", visaPayload("synthetic.residence-purpose", "REQUIRED"))],
        supported,
      ),
    );
    const visa = decision.modifiers.find((m) => m.code === "VISA_REQUIRED");
    expect(visa?.qualifier).toBe("synthetic.residence-purpose");
    expect(visa?.provenance).toHaveLength(1);
  });

  it("emits a warning rule as a warning", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [caseTypeRule(), rule("r.warn", warningPayload("PROCESSING_TIME_INDICATION", "INFO", "90-business-days"))],
        supported,
      ),
    );
    expect(decision.warnings.map((w) => [w.code, w.qualifier])).toContainEqual([
      "PROCESSING_TIME_INDICATION",
      "90-business-days",
    ]);
    expect(decision.caseClassification.status).toBe("COMPLETE_WITH_WARNINGS");
  });
});

describe("unguarded NOT_APPLICABLE", () => {
  it("is a rule configuration error, not a question for the user", () => {
    const facts = userCaseFacts({ location: knownFact({ kind: "ABROAD", countryCode: null }) });
    const result = runEngine(
      facts,
      [
        caseTypeRule(),
        rule("r.doc", procedurePayload("synthetic.p", "REQUIRED", {
          kind: "COMPARE",
          path: "case.location.countryCode",
          operator: "EQ",
          operand: { kind: "STRING", value: "DE" },
        })),
      ],
      supported,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("UNGUARDED_NOT_APPLICABLE");
  });
});

describe("legal requirements do not depend on readiness", () => {
  it("keeps a required document required even when the applicant already holds it", () => {
    const withDocument = userCaseFacts(
      {},
      {
        documents: knownFact([
          {
            instanceId: "00000000-0000-4000-8000-00000000dddd" as never,
            documentTypeId: "synthetic.birth-certificate" as never,
            issuingCountry: knownFact(country("DE")),
            issueDate: unansweredFact,
            expiryDate: unansweredFact,
            language: unansweredFact,
            readinessStatus: "OBTAINED",
          },
        ]),
      },
    );
    const rules = [
      caseTypeRule(),
      rule("r.p", procedurePayload("synthetic.p")),
      rule("r.doc", documentPayload("synthetic.p", "synthetic.birth-certificate")),
    ];
    const withoutDocument = expectOk(runEngine(userCaseFacts(), rules, supported));
    const withIt = expectOk(runEngine(withDocument, rules, supported));
    expect(withIt.requiredDocuments.map((d) => d.key)).toEqual(withoutDocument.requiredDocuments.map((d) => d.key));
  });
});
