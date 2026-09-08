import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import { alwaysFalse, alwaysIndeterminate, alwaysTrue, firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import {
  caseTypePayload,
  documentPayload,
  literalParam,
  procedurePayload,
  procedureSelector,
} from "../fixtures/payloads";
import { expectErr, expectOk, runEngine } from "../fixtures/engine";
import type { DocumentRequirementPayload } from "../../src/rules/definitions/payloads";
import { makeRequiredProcedureKey } from "../../src/case-engine/canonicalization/keys";
import { CURRENT_DERIVED_KEY_FORMAT_VERSION } from "../../src/domain/evaluation/engine-descriptor";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { id } from "../fixtures/ids";

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

beforeEach(() => {
  resetRuleCounter();
});

describe("procedure requirements", () => {
  it("materialises a REQUIRED procedure with a content-derived key", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.proc", procedurePayload("synthetic.apostille", "REQUIRED", alwaysTrue, [literalParam("country", "DE")])),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toHaveLength(1);
    const expectedKey = unwrapOrThrow(
      makeRequiredProcedureKey(
        {
          procedureId: id("synthetic.apostille"),
          parameters: [{ name: "country", value: { kind: "STRING", value: "DE" } }],
          discriminator: null,
        },
        CURRENT_DERIVED_KEY_FORMAT_VERSION,
      ),
    );
    expect(decision.requiredProcedures[0]?.key).toBe(expectedKey);
    expect(String(expectedKey)).toBe("rp1:synthetic.apostille|country=s:DE|-");
  });

  it("does not materialise a NOT_REQUIRED procedure", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.proc", procedurePayload("synthetic.apostille", "NOT_REQUIRED")),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toEqual([]);
  });

  it("ignores a rule whose condition is false", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.proc", procedurePayload("synthetic.apostille", "REQUIRED", alwaysFalse)),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toEqual([]);
  });

  it("merges two rules that require the same thing and keeps both provenances", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("synthetic.apostille")),
          rule("r.b", procedurePayload("synthetic.apostille")),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toHaveLength(1);
    expect(decision.requiredProcedures[0]?.provenance.map((p) => String(p.ruleId))).toEqual(["r.a", "r.b"]);
  });

  it("promotes merged support to CONFIRMED when any supporting rule is confirmed", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("synthetic.apostille"), { verificationStatus: "STRONG_EVIDENCE" }),
          rule("r.b", procedurePayload("synthetic.apostille"), { verificationStatus: "CONFIRMED" }),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures[0]?.support).toBe("CONFIRMED");
  });

  it("keeps STRONG_EVIDENCE when nothing confirms it", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("synthetic.apostille"), { verificationStatus: "STRONG_EVIDENCE" }),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures[0]?.support).toBe("STRONG_EVIDENCE");
    expect(decision.caseClassification.status).toBe("COMPLETE_WITH_WARNINGS");
    expect(decision.warnings.map((w) => w.code)).toContain("STRONG_EVIDENCE_ONLY");
  });

  it("distinguishes procedures by their semantic parameters", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.de", procedurePayload("synthetic.apostille", "REQUIRED", alwaysTrue, [literalParam("country", "DE")])),
          rule("r.fr", procedurePayload("synthetic.apostille", "REQUIRED", alwaysTrue, [literalParam("country", "FR")])),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toHaveLength(2);
    expect(decision.requiredProcedures.map((p) => String(p.key))).toEqual([
      "rp1:synthetic.apostille|country=s:DE|-",
      "rp1:synthetic.apostille|country=s:FR|-",
    ]);
  });

  it("conflicts when two confirmed rules disagree and neither claims precedence", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("synthetic.apostille", "REQUIRED")),
          rule("r.b", procedurePayload("synthetic.apostille", "NOT_REQUIRED")),
        ],
        extras,
      ),
    );
    expect(error.kind).toBe("RULE_CONFIGURATION_ERROR");
    expect(error.code).toBe("DECISION_CONFLICT");
  });

  it("lets a confirmed exception win over the rule it excepts", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.general", procedurePayload("synthetic.apostille", "REQUIRED")),
          rule("r.exception", procedurePayload("synthetic.apostille", "NOT_REQUIRED"), {
            precedence: [{ relation: "EXCEPTION_TO", overRuleId: id("r.general") }],
          }),
        ],
        extras,
      ),
    );
    expect(decision.requiredProcedures).toEqual([]);
  });
});

describe("target resolution", () => {
  const caseTypeRule = rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));

  it("MATCHED: a document rule attaches to its procedure", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule,
          rule("r.proc", procedurePayload("synthetic.apostille")),
          rule("r.doc", documentPayload("synthetic.apostille", "synthetic.birth-certificate")),
        ],
        extras,
      ),
    );
    expect(decision.requiredDocuments).toHaveLength(1);
    expect(String(decision.requiredDocuments[0]?.key)).toContain("rd1:rp1%3Asynthetic.apostille");
  });

  it("NEGATIVELY_RESOLVED: the downstream effect simply does not apply", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule,
          rule("r.proc", procedurePayload("synthetic.apostille", "NOT_REQUIRED")),
          rule("r.doc", documentPayload("synthetic.apostille", "synthetic.birth-certificate")),
        ],
        extras,
      ),
    );
    expect(decision.requiredDocuments).toEqual([]);
    expect(decision.caseClassification.status).toBe("COMPLETE");
  });

  it("MISSING: an asserted rule pointing at nothing is a configuration error", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [caseTypeRule, rule("r.doc", documentPayload("synthetic.apostille", "synthetic.birth-certificate"))],
        extras,
      ),
    );
    expect(error.code).toBe("TARGET_MISSING");
  });

  it("AMBIGUOUS: a parameterless selector matching two procedures is an error", () => {
    const ambiguous: DocumentRequirementPayload = {
      family: "DOCUMENT_REQUIREMENT",
      scope: "CASE",
      condition: alwaysTrue,
      consequence: {
        forProcedure: procedureSelector("synthetic.apostille", null),
        documentTypeId: id("synthetic.birth-certificate"),
        issuingCountry: null,
        discriminator: null,
        requirement: "REQUIRED",
      },
    };
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule,
          rule("r.de", procedurePayload("synthetic.apostille", "REQUIRED", alwaysTrue, [literalParam("country", "DE")])),
          rule("r.fr", procedurePayload("synthetic.apostille", "REQUIRED", alwaysTrue, [literalParam("country", "FR")])),
          rule("r.doc", ambiguous),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("TARGET_AMBIGUOUS");
  });

  it("an indeterminate rule with an unresolvable target blocks instead of failing", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule,
          rule("r.doc", documentPayload("synthetic.apostille", "synthetic.birth-certificate", "REQUIRED", {
            kind: "COMPARE",
            path: "case.maritalStatus",
            operator: "EQ",
            operand: { kind: "STRING", value: "MARRIED" },
          })),
        ],
        { ...extras },
      ),
    );
    expect(decision.requiredDocuments).toEqual([]);
  });
});

describe("derived key format", () => {
  it("refuses to mint keys under an unknown format version", () => {
    const result = makeRequiredProcedureKey(
      { procedureId: id("synthetic.apostille"), parameters: [], discriminator: null },
      "2" as never,
    );
    expect(result.ok).toBe(false);
  });

  it("is stable regardless of the order parameters were authored in", () => {
    const a = unwrapOrThrow(
      makeRequiredProcedureKey(
        {
          procedureId: id("p"),
          parameters: [
            { name: "b", value: { kind: "STRING", value: "2" } },
            { name: "a", value: { kind: "STRING", value: "1" } },
          ],
          discriminator: null,
        },
        CURRENT_DERIVED_KEY_FORMAT_VERSION,
      ),
    );
    const b = unwrapOrThrow(
      makeRequiredProcedureKey(
        {
          procedureId: id("p"),
          parameters: [
            { name: "a", value: { kind: "STRING", value: "1" } },
            { name: "b", value: { kind: "STRING", value: "2" } },
          ],
          discriminator: null,
        },
        CURRENT_DERIVED_KEY_FORMAT_VERSION,
      ),
    );
    expect(a).toBe(b);
  });

  it("encodes separators so parameter values cannot forge a key", () => {
    const key = unwrapOrThrow(
      makeRequiredProcedureKey(
        {
          procedureId: id("p"),
          parameters: [{ name: "x", value: { kind: "STRING", value: "a|b;c" } }],
          discriminator: null,
        },
        CURRENT_DERIVED_KEY_FORMAT_VERSION,
      ),
    );
    expect(String(key)).toBe("rp1:p|x=s:a%7Cb%3Bc|-");
  });

  it("renders integer and boolean parameters distinctly", () => {
    const key = unwrapOrThrow(
      makeRequiredProcedureKey(
        {
          procedureId: id("p"),
          parameters: [
            { name: "n", value: { kind: "INTEGER", value: 2 } },
            { name: "f", value: { kind: "BOOLEAN", value: false } },
          ],
          discriminator: "second",
        },
        CURRENT_DERIVED_KEY_FORMAT_VERSION,
      ),
    );
    expect(String(key)).toBe("rp1:p|f=b:false;n=i:2|second");
  });
});

describe("indeterminate procedure rules", () => {
  it("blocks only when the possible outcome would change the decision", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("synthetic.apostille", "REQUIRED")),
          rule("r.b", procedurePayload("synthetic.apostille", "REQUIRED", alwaysIndeterminate)),
        ],
        extras,
      ),
    );
    expect(decision.blockingIssues).toEqual([]);
    expect(decision.caseClassification.status).toBe("COMPLETE");
  });

  it("blocks when the indeterminate rule could contradict the decision", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
          rule("r.a", procedurePayload("synthetic.apostille", "REQUIRED")),
          rule("r.b", procedurePayload("synthetic.apostille", "NOT_REQUIRED", {
            kind: "COMPARE",
            path: "case.maritalStatus",
            operator: "EQ",
            operand: { kind: "STRING", value: "MARRIED" },
          })),
        ],
        { ...extras },
        undefined,
      ),
    );
    expect(decision.caseClassification.status).toBe("COMPLETE");
  });
});
