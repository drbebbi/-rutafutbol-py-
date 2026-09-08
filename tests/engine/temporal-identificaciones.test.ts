import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import { firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import {
  caseTypePayload,
  documentPayload,
  procedurePayload,
  procedureSelector,
  residencePayload,
  unresolved,
} from "../fixtures/payloads";
import { expectOk, runEngine } from "../fixtures/engine";
import { knownFact } from "../../src/domain/case/knowledge";

/**
 * The open research conflict, modelled honestly.
 *
 * What is established: Residencia Temporal can in principle open the way to a
 * cedula. What is NOT established is the exact document set the
 * Identificaciones service requires from a temporal resident: the published
 * page is titled for temporal and permanent residents, yet its document list
 * names permanent-residence documents (Certificado de Radicacion Permanente,
 * Carnet de Admision Permanente).
 *
 * The engine must be able to say "this needs official verification" and point
 * at exactly what needs verifying, WITHOUT substituting an invented temporal
 * document list - and in particular without silently rewriting PERMANENTE as
 * TEMPORAL.
 */
const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [
    pathway("standard", [
      "STANDARD_FIRST_CEDULA_FROM_TEMPORAL",
      "TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED",
    ]),
  ],
};

beforeEach(() => {
  resetRuleCounter();
});

describe("temporal residence -> first cedula, Identificaciones document set", () => {
  const temporalFacts = () =>
    userCaseFacts({
      residence: {
        reportedType: knownFact("TEMPORAL"),
        card: { state: knownFact("HELD_VALID"), expiryDate: knownFact("2027-05-01" as never) },
      },
    });

  it("produces NEEDS_OFFICIAL_VERIFICATION with a precise target and no invented documents", () => {
    const decision = expectOk(
      runEngine(
        temporalFacts(),
        [
          rule("r.case-type", caseTypePayload("TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED")),
          rule("r.residence", residencePayload("TEMPORAL")),
          rule("r.procedure", procedurePayload("synthetic.identificaciones-cedula")),
          // The document set itself is CONFLICTING: the rule states what needs
          // verification and deliberately carries no document consequence.
          rule(
            "r.identificaciones-document-set",
            unresolved(
              documentPayload(
                "synthetic.identificaciones-cedula",
                "synthetic.residence-evidence-document",
              ),
              "CONFLICTING",
              {
                code: "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET",
                target: {
                  kind: "PROCEDURE",
                  targetProcedure: procedureSelector("synthetic.identificaciones-cedula"),
                },
              },
            ),
            { verificationStatus: "CONFLICTING" },
          ),
        ],
        extras,
      ),
    );

    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
    expect(decision.caseClassification.caseType).toBe("TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED");
    expect(decision.residenceClassification).toEqual({ state: "CLASSIFIED", classification: "TEMPORAL" });

    const flag = decision.verificationFlags.find(
      (entry) => entry.code === "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET",
    );
    expect(flag).toBeDefined();
    expect(flag?.reason).toBe("CONFLICTING");
    expect(flag?.target.kind).toBe("PROCEDURE");

    // The crucial assertion: no document requirement was invented to fill the
    // gap, and no pathway was selected for an unverified case.
    expect(decision.requiredDocuments).toEqual([]);
    expect(decision.applicablePathway).toBeNull();
  });

  it("keeps the unresolved rule visible rather than dropping it", () => {
    const decision = expectOk(
      runEngine(
        temporalFacts(),
        [
          rule("r.case-type", caseTypePayload("TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED")),
          rule("r.procedure", procedurePayload("synthetic.identificaciones-cedula")),
          rule(
            "r.identificaciones-document-set",
            unresolved(
              documentPayload(
                "synthetic.identificaciones-cedula",
                "synthetic.residence-evidence-document",
              ),
              "OFFICIAL_VERIFICATION_REQUIRED",
              {
                code: "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET",
                target: {
                  kind: "PROCEDURE",
                  targetProcedure: procedureSelector("synthetic.identificaciones-cedula"),
                },
              },
            ),
            { verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED" },
          ),
        ],
        extras,
      ),
    );
    expect(decision.verificationFlags.map((entry) => entry.reason)).toContain(
      "OFFICIAL_VERIFICATION_REQUIRED",
    );
    expect(decision.verificationFlags[0]?.provenance.map((p) => String(p.ruleId))).toEqual([
      "r.identificaciones-document-set",
    ]);
  });
});
