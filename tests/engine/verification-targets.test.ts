import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import {
  firstCedulaPolicy,
  pathway,
  resetRuleCounter,
  rule,
  supportedCoverage,
} from "../fixtures/rules";
import {
  caseTypePayload,
  documentPayload,
  documentSelector,
  feePayload,
  procedurePayload,
  procedureSelector,
  unresolved,
  visaPayload,
  warningPayload,
} from "../fixtures/payloads";
import { expectErr, expectOk, runEngine } from "../fixtures/engine";
import { id } from "../fixtures/ids";
import { literalParam } from "../fixtures/payloads";

/**
 * Where an unresolved rule points.
 *
 * A verification request names a procedure, document, visa purpose or fee
 * component with the same selectors the consequence families use, and the
 * engine resolves it against the decision it actually produced. There is no
 * fallback to "the case in general": a request that cannot be pointed at
 * anything, or that matches several things, is a defect in the knowledge base
 * and stops the evaluation.
 */
const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

const caseTypeRule = () => rule("r.ct", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));

beforeEach(() => {
  resetRuleCounter();
});

describe("verification target templates", () => {
  it("points a procedure request at the procedure the decision required", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule(
            "r.ask",
            unresolved(documentPayload("syn.p", "syn.d"), "CONFLICTING", {
              code: "DOCUMENT_REQUIREMENT_UNCONFIRMED",
              target: { kind: "PROCEDURE", targetProcedure: procedureSelector("syn.p") },
            }),
            { verificationStatus: "CONFLICTING" },
          ),
        ],
        extras,
      ),
    );
    const flag = decision.verificationFlags[0];
    expect(flag?.target).toEqual({ kind: "PROCEDURE", procedureKey: "rp1:syn.p||-" });
    // No document was invented to satisfy the request.
    expect(decision.requiredDocuments).toEqual([]);
  });

  it("points a document request at the document the decision required", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.doc", documentPayload("syn.p", "syn.d")),
          rule(
            "r.ask",
            unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", {
              code: "DOCUMENT_FORMALITY_UNCONFIRMED",
              target: { kind: "DOCUMENT", targetDocument: documentSelector("syn.p", "syn.d") },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.verificationFlags[0]?.target.kind).toBe("DOCUMENT");
  });

  it("points a fee request at a component the decision calculated", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule("r.fee", feePayload("syn.p", "syn.c", { kind: "FIXED", amount: { amountMinorUnits: 5, currency: id("PYG") } })),
          rule(
            "r.ask",
            unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", {
              code: "FEE_AMOUNT_UNCONFIRMED",
              target: {
                kind: "FEE_COMPONENT",
                targetProcedure: procedureSelector("syn.p"),
                componentCode: id("syn.c"),
              },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.verificationFlags[0]?.target).toEqual({
      kind: "FEE_COMPONENT",
      procedureKey: "rp1:syn.p||-",
      componentCode: "syn.c",
    });
  });

  it("names a visa purpose directly, because a literal needs nothing to match", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule(
            "r.visa",
            unresolved(visaPayload("syn.purpose", "REQUIRED"), "CONFLICTING", {
              code: "VISA_REQUIREMENT_UNCONFIRMED",
              target: { kind: "VISA_PURPOSE", purposeCode: id("syn.purpose") },
            }),
            { verificationStatus: "CONFLICTING" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.verificationFlags[0]?.target).toEqual({
      kind: "VISA_PURPOSE",
      purposeCode: "syn.purpose",
    });
  });

  it("refuses a request that matches no procedure, instead of widening it to the case", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule(
            "r.ask",
            unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", {
              code: "PROCEDURE_REQUIREMENT_UNCONFIRMED",
              target: { kind: "PROCEDURE", targetProcedure: procedureSelector("syn.absent") },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("VERIFICATION_TARGET_MISSING");
  });

  it("refuses a request that matches more than one procedure", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.de", procedurePayload("syn.p", "REQUIRED", undefined, [literalParam("country", "DE")])),
          rule("r.fr", procedurePayload("syn.p", "REQUIRED", undefined, [literalParam("country", "FR")])),
          rule(
            "r.ask",
            unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", {
              code: "PROCEDURE_REQUIREMENT_UNCONFIRMED",
              // A parameterless selector is a wildcard, and here it matches two.
              target: {
                kind: "PROCEDURE",
                targetProcedure: procedureSelector("syn.p", null),
              },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("VERIFICATION_TARGET_AMBIGUOUS");
  });

  it("refuses a fee request for a component the decision does not calculate", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p")),
          rule(
            "r.ask",
            unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", {
              code: "FEE_AMOUNT_UNCONFIRMED",
              target: {
                kind: "FEE_COMPONENT",
                targetProcedure: procedureSelector("syn.p"),
                componentCode: id("syn.absent"),
              },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("VERIFICATION_TARGET_MISSING");
  });

  it("drops a request about a procedure the decision ruled out", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("syn.p", "NOT_REQUIRED")),
          rule(
            "r.ask",
            unresolved(warningPayload("FEE_MAY_CHANGE"), "UNKNOWN", {
              code: "PROCEDURE_REQUIREMENT_UNCONFIRMED",
              target: { kind: "PROCEDURE", targetProcedure: procedureSelector("syn.p") },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    // Asking the user to verify something the decision already ruled out is
    // noise, not honesty.
    expect(decision.verificationFlags).toEqual([]);
  });

  it("silences a request from a rule a confirmed winner takes precedence over", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.ct", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), {
            precedence: [{ relation: "OVERRIDES", overRuleId: id("r.ask") }],
          }),
          rule(
            "r.ask",
            unresolved(caseTypePayload("SPECIAL_CASE"), "UNKNOWN", {
              code: "CASE_CLASSIFICATION_UNCONFIRMED",
              target: { kind: "CASE" },
            }),
            { verificationStatus: "UNKNOWN" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.verificationFlags).toEqual([]);
    expect(decision.caseClassification.caseType).toBe("STANDARD_FIRST_CEDULA_FROM_NONE");
  });
});
