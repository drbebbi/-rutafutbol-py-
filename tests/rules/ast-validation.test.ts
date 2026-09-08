import { describe, expect, it } from "vitest";
import {
  validateRuleRevisionStructure,
  type RuleValidationIssueCode,
} from "../../src/rules/validation/structural-validation";
import { ruleConditionNodeSchema, rulePayloadSchema, ruleRevisionSchema } from "../../src/rules/validation/schemas";
import type { RuleConditionNode } from "../../src/rules/definitions/ast";
import {
  AST_MAX_BOOLEAN_CHILDREN,
  AST_MAX_DEPTH,
  AST_MAX_NODES,
} from "../../src/rules/definitions/limits";
import type { RulePayload } from "../../src/rules/definitions/payloads";
import { alwaysTrue, rule } from "../fixtures/rules";
import { id } from "../fixtures/ids";

function classification(condition: RuleConditionNode, scope: RulePayload["scope"] = "CASE"): RulePayload {
  return {
    family: "CLASSIFICATION",
    scope,
    condition,
    subject: "CASE_TYPE",
    precedence: [],
    resolution: {
      state: "RESOLVED",
      consequence: { kind: "CASE_TYPE", caseType: "STANDARD_FIRST_CEDULA_FROM_NONE" },
    },
  };
}

function codesOf(payload: RulePayload, overrides: Parameters<typeof rule>[2] = {}): RuleValidationIssueCode[] {
  return validateRuleRevisionStructure(rule("synthetic.rule", payload, overrides)).map((issue) => issue.code);
}

function nest(depth: number): RuleConditionNode {
  let node: RuleConditionNode = alwaysTrue;
  for (let i = 0; i < depth; i += 1) {
    node = { kind: "NOT", child: node };
  }
  return node;
}

describe("rule condition schema", () => {
  it("accepts every node kind", () => {
    const nodes: RuleConditionNode[] = [
      { kind: "CONSTANT", value: "INDETERMINATE" },
      { kind: "ALL", children: [alwaysTrue] },
      { kind: "ANY", children: [alwaysTrue] },
      { kind: "NOT", child: alwaysTrue },
      { kind: "FACT_STATE", path: "case.adultStatus", states: ["KNOWN"] },
      {
        kind: "COMPARE",
        path: "case.adultStatus",
        operator: "EQ",
        operand: { kind: "STRING", value: "ADULT" },
      },
      {
        kind: "DATE_COMPARE",
        left: { kind: "EFFECTIVE_DATE" },
        operator: "ON_OR_AFTER",
        right: { kind: "LITERAL_DATE", value: "2026-01-01" as never },
      },
      {
        kind: "INTERVAL_OVERLAP_AT_LEAST",
        fromPath: "scope.residenceHistory.from",
        toPath: "scope.residenceHistory.to",
        within: null,
        atLeast: { years: 1, months: 0, days: 0 },
      },
    ];
    for (const node of nodes) {
      expect(ruleConditionNodeSchema.safeParse(node).success, node.kind).toBe(true);
    }
  });

  it("rejects unknown node kinds and unregistered paths", () => {
    expect(ruleConditionNodeSchema.safeParse({ kind: "EVAL", source: "1+1" }).success).toBe(false);
    expect(
      ruleConditionNodeSchema.safeParse({ kind: "FACT_STATE", path: "case.nope", states: ["KNOWN"] })
        .success,
    ).toBe(false);
  });

  it("validates whole payloads and revisions", () => {
    expect(rulePayloadSchema.safeParse(classification(alwaysTrue)).success).toBe(true);
    expect(ruleRevisionSchema.safeParse(rule("synthetic.rule", classification(alwaysTrue))).success).toBe(true);
    expect(rulePayloadSchema.safeParse({ family: "NOT_A_FAMILY" }).success).toBe(false);
  });
});

describe("structural validation", () => {
  it("accepts a well-formed rule", () => {
    expect(codesOf(classification(alwaysTrue))).toEqual([]);
  });

  it("enforces the depth limit", () => {
    expect(codesOf(classification(nest(AST_MAX_DEPTH - 1)))).toEqual([]);
    expect(codesOf(classification(nest(AST_MAX_DEPTH + 2)))).toContain("AST_DEPTH_EXCEEDED");
  });

  it("enforces the node count limit", () => {
    const children = Array.from({ length: AST_MAX_BOOLEAN_CHILDREN }, () => ({
      kind: "ALL" as const,
      children: [alwaysTrue, alwaysTrue, alwaysTrue, alwaysTrue, alwaysTrue],
    }));
    expect(codesOf(classification({ kind: "ALL", children }))).toContain("AST_NODE_COUNT_EXCEEDED");
    expect(AST_MAX_NODES).toBe(128);
  });

  it("enforces the boolean fan-out limit and rejects empty boolean nodes", () => {
    const tooMany = Array.from({ length: AST_MAX_BOOLEAN_CHILDREN + 1 }, () => alwaysTrue);
    expect(codesOf(classification({ kind: "ANY", children: tooMany }))).toContain(
      "AST_BOOLEAN_CHILDREN_EXCEEDED",
    );
    expect(codesOf(classification({ kind: "ALL", children: [] }))).toContain("AST_EMPTY_BOOLEAN_NODE");
  });

  it("rejects a scoped path read outside its scope", () => {
    const codes = codesOf(
      classification({
        kind: "COMPARE",
        path: "scope.nationality.countryCode",
        operator: "EQ",
        operand: { kind: "STRING", value: "DE" },
      }),
    );
    expect(codes).toContain("FACT_PATH_SCOPE_MISMATCH");
  });

  it("stops a legal requirement rule from reading document readiness", () => {
    const codes = codesOf({
      family: "DOCUMENT_REQUIREMENT",
      scope: "EACH_DOCUMENT_INSTANCE",
      condition: {
        kind: "COMPARE",
        path: "scope.document.readinessStatus",
        operator: "EQ",
        operand: { kind: "STRING", value: "OBTAINED" },
      },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: {
          forProcedure: { procedureId: id("synthetic.procedure"), parameters: [], discriminator: null },
          documentTypeId: id("synthetic.document"),
          issuingCountry: null,
          discriminator: null,
          requirement: "REQUIRED",
        },
      },
    });
    expect(codes).toContain("FACT_ACCESS_DOMAIN_FORBIDDEN");
  });

  it("lets a document reuse rule read document state", () => {
    const codes = codesOf({
      family: "DOCUMENT_REUSE",
      scope: "EACH_DOCUMENT_INSTANCE",
      condition: {
        kind: "COMPARE",
        path: "scope.document.readinessStatus",
        operator: "EQ",
        operand: { kind: "STRING", value: "OBTAINED" },
      },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: {
          forDocument: {
            forProcedure: { procedureId: id("synthetic.procedure"), parameters: null, discriminator: null },
            documentTypeId: id("synthetic.document"),
            issuingCountry: null,
            discriminator: null,
          },
          resolution: "REUSABLE_CONFIRMED",
        },
      },
    });
    expect(codes).toEqual([]);
  });

  it("rejects operator / value type mismatches", () => {
    expect(
      codesOf(
        classification({
          kind: "COMPARE",
          path: "case.citizenshipCountries",
          operator: "EQ",
          operand: { kind: "STRING", value: "DE" },
        }),
      ),
    ).toContain("OPERATOR_TYPE_MISMATCH");

    expect(
      codesOf(
        classification({
          kind: "COMPARE",
          path: "case.residence.card.expiryDate",
          operator: "EQ",
          operand: { kind: "STRING", value: "2026-01-01" },
        }),
      ),
    ).toContain("OPERATOR_TYPE_MISMATCH");

    expect(
      codesOf(
        classification({
          kind: "COMPARE",
          path: "case.citizenshipCount",
          operator: "COUNT_GTE",
          operand: { kind: "STRING", value: "2" },
        }),
      ),
    ).toContain("OPERATOR_TYPE_MISMATCH");

    expect(
      codesOf(
        classification({
          kind: "COMPARE",
          path: "case.holdsPreviousParaguayanCedula",
          operator: "EQ",
          operand: { kind: "INTEGER", value: 1 },
        }),
      ),
    ).toContain("OPERATOR_TYPE_MISMATCH");
  });

  it("requires date expressions to reference date facts", () => {
    expect(
      codesOf(
        classification({
          kind: "DATE_COMPARE",
          left: { kind: "FACT_DATE", path: "case.adultStatus" },
          operator: "ON",
          right: { kind: "EFFECTIVE_DATE" },
        }),
      ),
    ).toContain("OPERATOR_TYPE_MISMATCH");
  });

  it("requires interval endpoints to share a scope", () => {
    expect(
      codesOf(
        classification(
          {
            kind: "INTERVAL_OVERLAP_AT_LEAST",
            fromPath: "scope.residenceHistory.from",
            toPath: "case.residence.card.expiryDate",
            within: null,
            atLeast: { years: 1, months: 0, days: 0 },
          },
          "EACH_RESIDENCE_HISTORY_ENTRY",
        ),
      ),
    ).toContain("INTERVAL_PATH_SCOPE_MISMATCH");
  });

  it("requires evidence for a resolved rule and a declaration for an unresolved one", () => {
    const withEvidence = rule("synthetic.rule", classification(alwaysTrue));
    const stripped = { ...withEvidence, evidence: [] };
    expect(validateRuleRevisionStructure(stripped).map((issue) => issue.code)).toContain(
      "MISSING_EVIDENCE",
    );

    // A rule whose evidence is unresolved but which still states a consequence
    // is the defect the model exists to make impossible.
    expect(
      validateRuleRevisionStructure({
        ...withEvidence,
        verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED",
      }).map((i) => i.code),
    ).toContain("MISSING_VERIFICATION_DECLARATION");

    // ...and so is the reverse: a confirmed rule that only asks a question.
    const asksForVerification = rule("synthetic.rule", classification(alwaysTrue), {
      verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED",
    });
    expect(
      validateRuleRevisionStructure({
        ...asksForVerification,
        verificationStatus: "CONFIRMED",
      }).map((i) => i.code),
    ).toContain("RESOLUTION_STATUS_MISMATCH");

    // The reason an unresolved rule gives must be the status it carries.
    expect(
      validateRuleRevisionStructure({
        ...asksForVerification,
        verificationStatus: "CONFLICTING",
      }).map((i) => i.code),
    ).toContain("RESOLUTION_STATUS_MISMATCH");
  });

  it("rejects a classification rule whose consequence contradicts its subject", () => {
    const base = rule("synthetic.rule", classification(alwaysTrue));
    expect(
      validateRuleRevisionStructure({
        ...base,
        payload: { ...base.payload, subject: "RESIDENCE_CLASSIFICATION" } as typeof base.payload,
      }).map((i) => i.code),
    ).toContain("CLASSIFICATION_SUBJECT_MISMATCH");
  });

  it("rejects an inverted effective window and self / duplicate precedence", () => {
    const base = rule("synthetic.rule", classification(alwaysTrue));
    expect(
      validateRuleRevisionStructure({ ...base, validFrom: "2026-05-01" as never, validUntil: "2026-01-01" as never })
        .map((i) => i.code),
    ).toContain("INVALID_EFFECTIVE_WINDOW");

    expect(
      validateRuleRevisionStructure({
        ...base,
        payload: {
          ...base.payload,
          precedence: [
            { relation: "OVERRIDES", overRuleId: id("synthetic.rule") },
            { relation: "EXCEPTION_TO", overRuleId: id("other.rule") },
            { relation: "EXCEPTION_TO", overRuleId: id("other.rule") },
          ],
        },
      }).map((i) => i.code),
    ).toEqual(expect.arrayContaining(["SELF_PRECEDENCE", "DUPLICATE_PRECEDENCE_EDGE"]));
  });

  it("rejects an unsupported payload schema version", () => {
    const base = rule("synthetic.rule", classification(alwaysTrue));
    expect(
      validateRuleRevisionStructure({ ...base, payloadSchemaVersion: "rule-payload@9.9" as never }).map(
        (i) => i.code,
      ),
    ).toContain("UNSUPPORTED_PAYLOAD_SCHEMA_VERSION");
  });
});

describe("structural validation, remaining paths", () => {
  it("reports an unregistered fact path", () => {
    const codes = codesOf(
      classification({
        kind: "FACT_STATE",
        path: "case.favouriteColour" as never,
        states: ["KNOWN"],
      }),
    );
    expect(codes).toContain("UNKNOWN_FACT_PATH");
  });

  it("walks shifted date expressions and interval windows", () => {
    const codes = codesOf(
      classification({
        kind: "DATE_COMPARE",
        left: {
          kind: "SHIFTED",
          base: { kind: "FACT_DATE", path: "case.adultStatus" },
          direction: "PLUS",
          period: { years: 1, months: 0, days: 0 },
        },
        operator: "ON",
        right: { kind: "EFFECTIVE_DATE" },
      }),
    );
    expect(codes).toContain("OPERATOR_TYPE_MISMATCH");

    const windowCodes = codesOf(
      classification({
        kind: "INTERVAL_OVERLAP_AT_LEAST",
        fromPath: "case.residence.card.expiryDate",
        toPath: "case.residence.card.expiryDate",
        within: {
          from: { kind: "FACT_DATE", path: "case.adultStatus" },
          to: { kind: "FACT_DATE", path: "case.maritalStatus" },
        },
        atLeast: { years: 1, months: 0, days: 0 },
      }),
    );
    expect(windowCodes.filter((code) => code === "OPERATOR_TYPE_MISMATCH")).toHaveLength(2);
  });

  it("rejects a string path compared to a boolean operand", () => {
    expect(
      codesOf(
        classification({
          kind: "COMPARE",
          path: "case.adultStatus",
          operator: "EQ",
          operand: { kind: "BOOLEAN", value: true },
        }),
      ),
    ).toContain("OPERATOR_TYPE_MISMATCH");
  });

  it("accepts a knowledge-state test on a registered path", () => {
    expect(
      codesOf(classification({ kind: "FACT_STATE", path: "case.maritalStatus", states: ["KNOWN", "UNKNOWN"] })),
    ).toEqual([]);
  });
});
