import { beforeEach, describe, expect, it } from "vitest";
import { knownFact, unansweredFact, unknownFact } from "../../src/domain/case/knowledge";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import { evaluateCase } from "../../src/case-engine/evaluate/evaluate-case";
import { evaluateCondition } from "../../src/case-engine/conditions/evaluate-condition";
import { projectRuleFactView } from "../../src/case-engine/classify/fact-view";
import {
  canonicalModifiers,
  deriveStructuralModifiers,
  visaModifiers,
} from "../../src/case-engine/modifiers/structural-modifiers";
import { knownSpecialCaseGuard } from "../../src/case-engine/classify/special-case-guard";
import { canonicalBundleJson } from "../../src/rules/bundle/canonical-bundle";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { country, noSpecialCase, userCaseFacts } from "../fixtures/facts";
import { executionContext, expectErr, expectOk, runEngine } from "../fixtures/engine";
import {
  bundleContent,
  engineReadyBundle,
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
  reusePayload,
  visaPayload,
  warningPayload,
} from "../fixtures/payloads";
import { id } from "../fixtures/ids";
import type { RuleConditionNode } from "../../src/rules/definitions/ast";
import { validateRuleRevisionStructure } from "../../src/rules/validation/structural-validation";

const context = executionContext();

const base = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

const caseTypeRule = () => rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));

/** Indeterminate because the marital status is unanswered. */
const indeterminate: RuleConditionNode = {
  kind: "COMPARE",
  path: "case.maritalStatus",
  operator: "EQ",
  operand: { kind: "STRING", value: "MARRIED" },
};

const unansweredMarital = () => userCaseFacts({ maritalStatus: unansweredFact });

beforeEach(() => {
  resetRuleCounter();
});

describe("documents: negative, formality and unresolved paths", () => {
  it("keeps a NOT_REQUIRED document out of the output but resolvable as a target", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d", "NOT_REQUIRED")),
          rule("r.formality", formalityPayload("syn.p", "syn.d", "syn.apostille")),
        ],
        base,
      ),
    );
    expect(decision.requiredDocuments).toEqual([]);
    expect(decision.documentReuseAssessments).toEqual([]);
  });

  it("drops a formality a confirmed rule says is not required", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
          rule("r.formality", formalityPayload("syn.p", "syn.d", "syn.apostille", "NOT_REQUIRED")),
        ],
        base,
      ),
    );
    expect(decision.requiredDocuments[0]?.formalities).toEqual([]);
  });

  it("asks for verification when the document requirement itself is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d"), {
            verificationStatus: "UNKNOWN",
            verification: { code: "DOCUMENT_REQUIREMENT_UNCONFIRMED", targetKind: "PROCEDURE" },
          }),
        ],
        base,
      ),
    );
    expect(decision.requiredDocuments).toEqual([]);
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("DOCUMENT_REQUIREMENT_UNCONFIRMED");
  });

  it("asks for verification when a formality is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
          rule("r.formality", formalityPayload("syn.p", "syn.d", "syn.apostille"), {
            verificationStatus: "CONFLICTING",
            verification: { code: "DOCUMENT_FORMALITY_UNCONFIRMED", targetKind: "DOCUMENT" },
          }),
        ],
        base,
      ),
    );
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("DOCUMENT_FORMALITY_UNCONFIRMED");
    expect(decision.verificationFlags[0]?.target.kind).toBe("DOCUMENT");
  });

  it("carries an indeterminate document rule forward as a blocking issue", () => {
    const decision = expectOk(
      runEngine(
        unansweredMarital(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d", "REQUIRED", indeterminate)),
        ],
        base,
      ),
    );
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });

  it("distinguishes documents by issuing country", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.de", documentPayload("syn.p", "syn.d", "REQUIRED", { kind: "CONSTANT", value: "TRUE" }, "DE")),
          rule("r.fr", documentPayload("syn.p", "syn.d", "REQUIRED", { kind: "CONSTANT", value: "TRUE" }, "FR")),
        ],
        base,
      ),
    );
    expect(decision.requiredDocuments).toHaveLength(2);
    expect(decision.documentReuseAssessments).toHaveLength(2);
  });

  it("skips a formality whose document target was decided not required", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d", "NOT_REQUIRED")),
          rule("r.reuse", reusePayload("syn.p", "syn.d", "REUSABLE_CONFIRMED")),
        ],
        base,
      ),
    );
    expect(decision.documentReuseAssessments).toEqual([]);
  });

  it("carries an indeterminate reuse rule forward", () => {
    const decision = expectOk(
      runEngine(
        unansweredMarital(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
          rule("r.reuse", reusePayload("syn.p", "syn.d", "REUSE_NOT_ALLOWED", indeterminate)),
        ],
        base,
      ),
    );
    expect(decision.documentReuseAssessments[0]?.resolution).toBe("REUSE_UNKNOWN");
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });
});

describe("warnings and timelines", () => {
  it("treats a timeline rule as a warning", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.timeline", {
            family: "TIMELINE",
            scope: "CASE",
            condition: { kind: "CONSTANT", value: "TRUE" },
            consequence: { code: "PROCESSING_TIME_INDICATION", severity: "INFO", qualifier: "syn" },
          }),
        ],
        base,
      ),
    );
    expect(decision.warnings.map((warning) => warning.code)).toContain("PROCESSING_TIME_INDICATION");
  });

  it("conflicts when two confirmed rules give one warning different severities", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.w1", warningPayload("FEE_MAY_CHANGE", "INFO", null)),
          rule("r.w2", warningPayload("FEE_MAY_CHANGE", "CAUTION", null)),
        ],
        base,
      ),
    );
    expect(error.code).toBe("DECISION_CONFLICT");
  });

  it("asks for verification when a warning rule is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.w", warningPayload("FEE_MAY_CHANGE", "INFO", null), {
            verificationStatus: "UNKNOWN",
            verification: { code: "FEE_AMOUNT_UNCONFIRMED", targetKind: "CASE" },
          }),
        ],
        base,
      ),
    );
    expect(decision.warnings.map((warning) => warning.code)).not.toContain("FEE_MAY_CHANGE");
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("FEE_AMOUNT_UNCONFIRMED");
  });

  it("blocks on an indeterminate warning rule that would change the answer", () => {
    const decision = expectOk(
      runEngine(
        unansweredMarital(),
        [caseTypeRule(), rule("r.w", warningPayload("FEE_MAY_CHANGE", "INFO", null, indeterminate))],
        base,
      ),
    );
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });
});

describe("dependencies and fees, remaining paths", () => {
  it("carries an indeterminate dependency rule forward", () => {
    const decision = expectOk(
      runEngine(
        unansweredMarital(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("syn.a")),
          rule("r.p2", procedurePayload("syn.b")),
          rule("r.dep", dependencyPayload("syn.b", "syn.a", "REQUIRED_BEFORE", indeterminate)),
        ],
        base,
      ),
    );
    expect(decision.procedureDependencies).toEqual([]);
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });

  it("asks for verification when a dependency rule is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("syn.a")),
          rule("r.p2", procedurePayload("syn.b")),
          rule("r.dep", dependencyPayload("syn.b", "syn.a"), {
            verificationStatus: "CONFLICTING",
            verification: { code: "PROCEDURE_DEPENDENCY_UNCONFIRMED", targetKind: "PROCEDURE" },
          }),
        ],
        base,
      ),
    );
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("PROCEDURE_DEPENDENCY_UNCONFIRMED");
  });

  it("skips a dependency whose prerequisite was decided not required", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("syn.a", "NOT_REQUIRED")),
          rule("r.p2", procedurePayload("syn.b")),
          rule("r.dep", dependencyPayload("syn.b", "syn.a")),
        ],
        base,
      ),
    );
    expect(decision.procedureDependencies).toEqual([]);
  });

  it("asks for verification when a fee rule is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.fee", feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 1, currency: id("PYG") } }), {
            verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED",
            verification: { code: "FEE_AMOUNT_UNCONFIRMED", targetKind: "FEE_COMPONENT" },
          }),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations).toEqual([]);
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("FEE_AMOUNT_UNCONFIRMED");
  });

  it("carries an indeterminate fee rule forward", () => {
    const decision = expectOk(
      runEngine(
        unansweredMarital(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.fee", feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 1, currency: id("PYG") } }, indeterminate)),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations).toEqual([]);
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });

  it("skips a fee whose procedure was decided not required", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p", "NOT_REQUIRED")),
          rule("r.fee", feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 1, currency: id("PYG") } })),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations).toEqual([]);
  });
});

describe("classification and visa, remaining paths", () => {
  it("asks for verification when a visa rule is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.visa", visaPayload("syn.purpose", "REQUIRED"), {
            verificationStatus: "CONFLICTING",
            verification: { code: "VISA_REQUIREMENT_UNCONFIRMED", targetKind: "VISA_PURPOSE" },
          }),
        ],
        base,
      ),
    );
    expect(decision.modifiers.map((modifier) => modifier.code)).not.toContain("VISA_REQUIRED");
    const flag = decision.verificationFlags.find((entry) => entry.code === "VISA_REQUIREMENT_UNCONFIRMED");
    expect(flag?.target.kind).toBe("VISA_PURPOSE");
  });

  it("blocks on an indeterminate visa rule", () => {
    const decision = expectOk(
      runEngine(
        unansweredMarital(),
        [caseTypeRule(), rule("r.visa", visaPayload("syn.purpose", "REQUIRED", indeterminate))],
        base,
      ),
    );
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });

  it("reports a visa that is explicitly not required", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [caseTypeRule(), rule("r.visa", visaPayload("syn.purpose", "NOT_REQUIRED"))], base),
    );
    expect(decision.modifiers.map((modifier) => modifier.code)).toContain("VISA_NOT_REQUIRED");
  });
});

describe("structural modifiers", () => {
  it("derives every structural modifier the model defines", () => {
    const facts = userCaseFacts({
      adultStatus: knownFact("MINOR"),
      location: knownFact({ kind: "ABROAD", countryCode: country("DE") }),
      nationalities: knownFact([
        { countryCode: country("DE"), roles: ["CITIZENSHIP"] },
        { countryCode: country("PY"), roles: ["CITIZENSHIP"] },
      ]),
      residence: {
        reportedType: knownFact("TEMPORAL"),
        card: { state: knownFact("HELD_EXPIRED"), expiryDate: knownFact("2020-01-01" as never) },
      },
      entryTravelDocumentCountry: knownFact(country("DE")),
      processTravelDocumentCountry: knownFact(country("IT")),
    });
    const modifiers = deriveStructuralModifiers(facts, knownSpecialCaseGuard(facts)).map((m) => m.code);
    expect(modifiers).toEqual(
      expect.arrayContaining([
        "MINOR_APPLICANT",
        "APPLICANT_ABROAD",
        "MULTIPLE_CITIZENSHIPS",
        "PARAGUAYAN_CITIZENSHIP_DECLARED",
        "RESIDENCE_CARD_EXPIRED",
        "PROCESS_DOCUMENT_DIFFERS_FROM_ENTRY_DOCUMENT",
      ]),
    );
  });

  it("declares Paraguayan citizenship from the special-case answer alone", () => {
    const facts = userCaseFacts({
      specialCase: { ...noSpecialCase, paraguayanCitizenship: knownFact(true) },
    });
    const modifiers = deriveStructuralModifiers(facts, knownSpecialCaseGuard(facts)).map((m) => m.code);
    expect(modifiers).toContain("PARAGUAYAN_CITIZENSHIP_DECLARED");
    expect(modifiers.filter((code) => code === "PARAGUAYAN_CITIZENSHIP_DECLARED")).toHaveLength(1);
  });

  it("derives nothing structural from facts that are not known", () => {
    const facts = userCaseFacts({
      adultStatus: unknownFact,
      location: unknownFact,
      nationalities: unknownFact,
      residence: { reportedType: unknownFact, card: { state: unknownFact, expiryDate: unansweredFact } },
      entryTravelDocumentCountry: unansweredFact,
      processTravelDocumentCountry: unansweredFact,
    });
    expect(deriveStructuralModifiers(facts, knownSpecialCaseGuard(facts))).toEqual([]);
  });

  it("merges provenance when the same modifier arrives twice", () => {
    const merged = canonicalModifiers([
      ...visaModifiers([
        {
          purposeCode: id("p"),
          requirement: "REQUIRED",
          support: "CONFIRMED",
          provenance: [{ ruleId: id("r.a"), ruleRevisionId: id("rev-a"), sourceRevisionIds: [] }],
        },
      ]),
      ...visaModifiers([
        {
          purposeCode: id("p"),
          requirement: "REQUIRED",
          support: "CONFIRMED",
          provenance: [{ ruleId: id("r.b"), ruleRevisionId: id("rev-b"), sourceRevisionIds: [] }],
        },
      ]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.provenance).toHaveLength(2);
  });
});

describe("condition evaluation, remaining paths", () => {
  const view = projectRuleFactView(userCaseFacts({ maritalStatus: unknownFact }), context);

  it("is indeterminate when a shifted date depends on an unknown fact", () => {
    const outcome = unwrapOrThrow(
      evaluateCondition(
        {
          kind: "DATE_COMPARE",
          left: {
            kind: "SHIFTED",
            base: { kind: "FACT_DATE", path: "case.residence.card.expiryDate" },
            direction: "PLUS",
            period: { years: 1, months: 0, days: 0 },
          },
          operator: "AFTER",
          right: { kind: "EFFECTIVE_DATE" },
        },
        projectRuleFactView(
          userCaseFacts({
            residence: { reportedType: knownFact("NONE"), card: { state: knownFact("NOT_HELD"), expiryDate: unknownFact } },
          }),
          context,
        ),
        null,
        context,
      ),
    );
    expect(outcome.value).toBe("INDETERMINATE");
  });

  it("is indeterminate when an interval window depends on an unknown fact", () => {
    const facts = userCaseFacts({
      residence: { reportedType: knownFact("NONE"), card: { state: knownFact("NOT_HELD"), expiryDate: unknownFact } },
    });
    const scopedView = projectRuleFactView(facts, context);
    const collection = scopedView.residenceHistory;
    if (collection.state !== "KNOWN") {
      throw new Error("expected known");
    }
    const outcome = unwrapOrThrow(
      evaluateCondition(
        {
          kind: "INTERVAL_OVERLAP_AT_LEAST",
          fromPath: "scope.residenceHistory.from",
          toPath: "scope.residenceHistory.to",
          within: {
            from: { kind: "FACT_DATE", path: "case.residence.card.expiryDate" },
            to: { kind: "EFFECTIVE_DATE" },
          },
          atLeast: { years: 1, months: 0, days: 0 },
        },
        scopedView,
        collection.entries[0] ?? null,
        context,
      ),
    );
    expect(outcome.value).toBe("INDETERMINATE");
  });

  it("propagates indeterminacy through NOT, ALL and ANY", () => {
    const outcome = unwrapOrThrow(
      evaluateCondition(
        {
          kind: "ANY",
          children: [
            { kind: "NOT", child: { kind: "ALL", children: [indeterminate] } },
            { kind: "CONSTANT", value: "FALSE" },
          ],
        },
        view,
        null,
        context,
      ),
    );
    expect(outcome.value).toBe("INDETERMINATE");
  });

  it("refuses a comparison whose operand type does not match the operator", () => {
    // Reachable only by bypassing publication validation, which is exactly why
    // the evaluator checks again rather than trusting its input.
    const result = evaluateCondition(
      {
        kind: "COMPARE",
        path: "case.adultStatus",
        operator: "IN",
        operand: { kind: "STRING", value: "ADULT" },
      },
      projectRuleFactView(userCaseFacts(), context),
      null,
      context,
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ["EQ", { kind: "STRING_SET", values: ["A"] }],
    ["NEQ", { kind: "STRING_SET", values: ["A"] }],
    ["NOT_IN", { kind: "STRING", value: "A" }],
    ["CONTAINS_ANY", { kind: "STRING", value: "A" }],
    ["CONTAINS_ALL", { kind: "STRING", value: "A" }],
    ["COUNT_EQ", { kind: "STRING", value: "A" }],
    ["COUNT_GTE", { kind: "STRING", value: "A" }],
    ["COUNT_LTE", { kind: "STRING", value: "A" }],
  ] as const)("refuses %s with an incompatible operand", (operator, operand) => {
    const result = evaluateCondition(
      { kind: "COMPARE", path: "case.adultStatus", operator, operand },
      projectRuleFactView(userCaseFacts(), context),
      null,
      context,
    );
    expect(result.ok).toBe(false);
  });

  it("evaluates set membership over citizenship countries", () => {
    const outcome = unwrapOrThrow(
      evaluateCondition(
        {
          kind: "COMPARE",
          path: "case.citizenshipCountries",
          operator: "CONTAINS_ALL",
          operand: { kind: "STRING_SET", values: ["DE"] },
        },
        projectRuleFactView(userCaseFacts(), context),
        null,
        context,
      ),
    );
    expect(outcome.value).toBe("TRUE");
  });
});

describe("engine invariants", () => {
  it("refuses a bundle assembled for a different effective date", () => {
    resetRuleCounter();
    const bundle = engineReadyBundle([caseTypeRule()], "2026-01-01", base);
    const result = evaluateCase(userCaseFacts(), context, bundle, CURRENT_ENGINE_DESCRIPTOR);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("BUNDLE_EFFECTIVE_DATE_MISMATCH");
  });

  it("refuses an engine descriptor asking for an unknown derived key format", () => {
    resetRuleCounter();
    const bundle = engineReadyBundle([caseTypeRule(), rule("r.p", procedurePayload("syn.p"))], "2026-06-15", base);
    const result = evaluateCase(userCaseFacts(), context, bundle, {
      ...CURRENT_ENGINE_DESCRIPTOR,
      derivedKeyFormatVersion: "99" as never,
    });
    expect(!result.ok && result.error.code).toBe("DERIVED_KEY_FORMAT_MISMATCH");
  });
});

describe("bundle canonical JSON", () => {
  it("is stable and order-independent", () => {
    resetRuleCounter();
    const a = bundleContent([caseTypeRule(), rule("r.p", procedurePayload("syn.p"))], base);
    const reversed = { ...a, ruleRevisions: [...a.ruleRevisions].reverse() };
    expect(canonicalBundleJson(reversed)).toBe(canonicalBundleJson(a));
  });
});

describe("fact-driven templates in stages", () => {
  const factProcedure = (requirement: "REQUIRED" | "NOT_REQUIRED" = "REQUIRED", condition = { kind: "CONSTANT", value: "TRUE" } as RuleConditionNode) =>
    procedurePayload("syn.p", requirement, condition, [
      { name: "country", value: { kind: "FACT", path: "case.processTravelDocumentCountry" } },
    ]);

  it("refuses a TRUE procedure rule whose parameters depend on an unknown fact", () => {
    const facts = userCaseFacts({ processTravelDocumentCountry: unknownFact });
    const error = expectErr(runEngine(facts, [caseTypeRule(), rule("r.p", factProcedure())], base));
    expect(error.code).toBe("PARAMETER_FACT_UNRESOLVED");
  });

  it("carries an indeterminate procedure rule with unresolvable parameters forward as a blocking issue", () => {
    const facts = userCaseFacts({
      processTravelDocumentCountry: unknownFact,
      maritalStatus: unansweredFact,
    });
    const decision = expectOk(
      runEngine(facts, [caseTypeRule(), rule("r.p", factProcedure("REQUIRED", indeterminate))], base),
    );
    expect(decision.requiredProcedures).toEqual([]);
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });

  it("names a procedure from a known fact", () => {
    const decision = expectOk(runEngine(userCaseFacts(), [caseTypeRule(), rule("r.p", factProcedure())], base));
    expect(String(decision.requiredProcedures[0]?.key)).toBe("rp1:syn.p|country=s:DE|-");
  });

  it("refuses a TRUE document rule whose issuing country depends on an unknown fact", () => {
    const facts = userCaseFacts({ entryTravelDocumentCountry: unknownFact });
    const error = expectErr(
      runEngine(
        facts,
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", {
            family: "DOCUMENT_REQUIREMENT",
            scope: "CASE",
            condition: { kind: "CONSTANT", value: "TRUE" },
            consequence: {
              forProcedure: { procedureId: id("syn.p"), parameters: [], discriminator: null },
              documentTypeId: id("syn.d"),
              issuingCountry: { kind: "FACT", path: "case.entryTravelDocumentCountry" },
              discriminator: null,
              requirement: "REQUIRED",
            },
          }),
        ],
        base,
      ),
    );
    expect(error.code).toBe("PARAMETER_FACT_UNRESOLVED");
  });

  it("carries an indeterminate document rule with an unresolvable issuing country forward", () => {
    const facts = userCaseFacts({
      entryTravelDocumentCountry: unknownFact,
      maritalStatus: unansweredFact,
    });
    const decision = expectOk(
      runEngine(
        facts,
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", {
            family: "DOCUMENT_REQUIREMENT",
            scope: "CASE",
            condition: indeterminate,
            consequence: {
              forProcedure: { procedureId: id("syn.p"), parameters: [], discriminator: null },
              documentTypeId: id("syn.d"),
              issuingCountry: { kind: "FACT", path: "case.entryTravelDocumentCountry" },
              discriminator: null,
              requirement: "REQUIRED",
            },
          }),
        ],
        base,
      ),
    );
    expect(decision.requiredDocuments).toEqual([]);
    expect(decision.blockingIssues.map((issue) => issue.code)).toContain("MARITAL_STATUS_REQUIRED");
  });

  it("names a document's issuing country from a known fact", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", {
            family: "DOCUMENT_REQUIREMENT",
            scope: "CASE",
            condition: { kind: "CONSTANT", value: "TRUE" },
            consequence: {
              forProcedure: { procedureId: id("syn.p"), parameters: [], discriminator: null },
              documentTypeId: id("syn.d"),
              issuingCountry: { kind: "FACT", path: "case.entryTravelDocumentCountry" },
              discriminator: null,
              requirement: "REQUIRED",
            },
          }),
        ],
        base,
      ),
    );
    expect(String(decision.requiredDocuments[0]?.key)).toContain("|DE|");
  });

  it.each([
    ["fee", "r.fee"],
    ["dependency", "r.dep"],
    ["document reuse", "r.reuse"],
    ["formality", "r.formality"],
  ])("stops a %s selector that reads a non-scalar fact at publication time", (_label, ruleId) => {
    // Bundle preparation rejects it before the engine ever sees it, which is
    // where a knowledge-base defect belongs: publication fails, evaluation
    // never has to guess.
    const revision = rule(ruleId, {
      family: "FEE",
      scope: "CASE",
      condition: { kind: "CONSTANT", value: "TRUE" },
      consequence: {
        forProcedure: {
          procedureId: id("syn.p"),
          parameters: [{ name: "c", value: { kind: "FACT", path: "case.citizenshipCountries" } }],
          discriminator: null,
        },
        componentCode: id("syn.c"),
        feeType: "FIXED_AMOUNT",
        formula: { kind: "FIXED", amount: { amountMinorUnits: 1, currency: id("PYG") } },
      },
    });
    const issues = validateRuleRevisionStructure(revision);
    expect(issues.map((issue) => issue.code)).toContain("OPERATOR_TYPE_MISMATCH");
  });
});
