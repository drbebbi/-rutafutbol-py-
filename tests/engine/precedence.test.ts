import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import { alwaysTrue, bundleContent, firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import { caseTypePayload, feePayload, procedurePayload, visaPayload } from "../fixtures/payloads";
import { expectErr, expectOk, runEngine } from "../fixtures/engine";
import { prepareEngineReadyBundle } from "../../src/rules/bundle/engine-ready-bundle";
import { validatePrecedenceGraph } from "../../src/rules/conflicts/precedence-validation";
import type { CaseType } from "../../src/domain/case/classification";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { id } from "../fixtures/ids";

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [
    pathway("standard", [
      "STANDARD_FIRST_CEDULA_FROM_NONE",
      "STANDARD_FIRST_CEDULA_FROM_TEMPORAL",
      "STANDARD_FIRST_CEDULA_FROM_PERMANENT",
    ]),
  ],
};

const A: CaseType = "STANDARD_FIRST_CEDULA_FROM_NONE";
const B: CaseType = "STANDARD_FIRST_CEDULA_FROM_TEMPORAL";
const C: CaseType = "STANDARD_FIRST_CEDULA_FROM_PERMANENT";

beforeEach(() => {
  resetRuleCounter();
});

describe("merging", () => {
  it("merges identical consequences", () => {
    const decision = expectOk(
      runEngine(userCaseFacts(), [rule("r.a", caseTypePayload(A)), rule("r.b", caseTypePayload(A))], extras),
    );
    expect(decision.caseClassification.caseType).toBe(A);
  });
});

describe("suppressive precedence", () => {
  it("EXCEPTION_TO lets the confirmed exception win", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.general", caseTypePayload(A)),
          rule("r.exception", caseTypePayload(B), {
            precedence: [{ relation: "EXCEPTION_TO", overRuleId: id("r.general") }],
          }),
        ],
        extras,
      ),
    );
    expect(decision.caseClassification.caseType).toBe(B);
  });

  it("OVERRIDES behaves the same way", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.general", caseTypePayload(A)),
          rule("r.special", caseTypePayload(B), {
            precedence: [{ relation: "OVERRIDES", overRuleId: id("r.general") }],
          }),
        ],
        extras,
      ),
    );
    expect(decision.caseClassification.caseType).toBe(B);
  });

  it("STRONG_EVIDENCE cannot suppress a contradicting confirmed rule", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          rule("r.general", caseTypePayload(A)),
          rule("r.weak", caseTypePayload(B), {
            verificationStatus: "STRONG_EVIDENCE",
            precedence: [{ relation: "OVERRIDES", overRuleId: id("r.general") }],
          }),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("DECISION_CONFLICT");
  });

  it("an unresolved rule cannot suppress anything", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.general", caseTypePayload(A)),
          rule("r.unresolved", caseTypePayload(B), {
            verificationStatus: "CONFLICTING",
            precedence: [{ relation: "OVERRIDES", overRuleId: id("r.general") }],
          }),
        ],
        extras,
      ),
    );
    // The confirmed rule still decides; the unresolved rule only asks for
    // verification - it never silently wins and never silently disappears.
    expect(decision.caseClassification.caseType).toBe(A);
    expect(decision.verificationFlags).toHaveLength(1);
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
  });

  it("a confirmed rule may silence an unresolved rule it explicitly excepts", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          rule("r.general", caseTypePayload(A), {
            precedence: [{ relation: "OVERRIDES", overRuleId: id("r.unresolved") }],
          }),
          rule("r.unresolved", caseTypePayload(B), { verificationStatus: "CONFLICTING" }),
        ],
        extras,
      ),
    );
    expect(decision.caseClassification.caseType).toBe(A);
    expect(decision.verificationFlags).toEqual([]);
  });
});

describe("direct dominance", () => {
  /**
   * The decisive case: A overrides B and B overrides C, but nothing says A
   * overrides C. Transitivity is not assumed, so this is a conflict.
   */
  it("A>B, B>C with three consequences and no A>C is a DECISION_CONFLICT", () => {
    const rules = [
      rule("r.a", caseTypePayload(A), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.b") }] }),
      rule("r.b", caseTypePayload(B), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.c") }] }),
      rule("r.c", caseTypePayload(C)),
    ];
    const error = expectErr(runEngine(userCaseFacts(), rules, extras));
    expect(error.code).toBe("DECISION_CONFLICT");
  });

  it("resolves once the winner dominates every opposing rule directly", () => {
    const rules = [
      rule("r.a", caseTypePayload(A), {
        precedence: [
          { relation: "OVERRIDES", overRuleId: id("r.b") },
          { relation: "OVERRIDES", overRuleId: id("r.c") },
        ],
      }),
      rule("r.b", caseTypePayload(B), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.c") }] }),
      rule("r.c", caseTypePayload(C)),
    ];
    expect(expectOk(runEngine(userCaseFacts(), rules, extras)).caseClassification.caseType).toBe(A);
  });

  it("is independent of the order the rules arrive in", () => {
    const build = () => [
      rule("r.a", caseTypePayload(A), {
        precedence: [
          { relation: "OVERRIDES", overRuleId: id("r.b") },
          { relation: "OVERRIDES", overRuleId: id("r.c") },
        ],
      }),
      rule("r.b", caseTypePayload(B), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.c") }] }),
      rule("r.c", caseTypePayload(C)),
    ];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const permutation of permutations) {
      resetRuleCounter();
      const source = build();
      const ordered = permutation.map((index) => source[index] as (typeof source)[number]);
      expect(expectOk(runEngine(userCaseFacts(), ordered, extras)).caseClassification.caseType).toBe(A);
    }
  });

  it("refuses when two groups each claim precedence over the other", () => {
    const rules = [
      rule("r.a", caseTypePayload(A), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.b") }] }),
      rule("r.b", caseTypePayload(B), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.a") }] }),
    ];
    const bundle = prepareEngineReadyBundle(bundleContent(rules, extras), "2026-06-15" as LocalDate);
    expect(bundle.ok).toBe(false);
  });
});

describe("precedence graph validation", () => {
  it("rejects a two-node cycle", () => {
    const issues = validatePrecedenceGraph([
      rule("r.a", caseTypePayload(A), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.b") }] }),
      rule("r.b", caseTypePayload(B), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.a") }] }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain("PRECEDENCE_CYCLE");
  });

  it("rejects a three-node cycle", () => {
    const issues = validatePrecedenceGraph([
      rule("r.a", caseTypePayload(A), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.b") }] }),
      rule("r.b", caseTypePayload(B), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.c") }] }),
      rule("r.c", caseTypePayload(C), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.a") }] }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain("PRECEDENCE_CYCLE");
  });

  it("accepts an acyclic graph", () => {
    expect(
      validatePrecedenceGraph([
        rule("r.a", caseTypePayload(A), { precedence: [{ relation: "OVERRIDES", overRuleId: id("r.b") }] }),
        rule("r.b", caseTypePayload(B)),
      ]),
    ).toEqual([]);
  });

  it("rejects precedence across incompatible decision slot families", () => {
    const issues = validatePrecedenceGraph([
      rule("r.fee", feePayload("synthetic.p", "synthetic.c", { kind: "FIXED", amount: { amountMinorUnits: 1, currency: id("PYG") } }), {
        precedence: [{ relation: "OVERRIDES", overRuleId: id("r.visa") }],
      }),
      rule("r.visa", visaPayload("synthetic.purpose", "REQUIRED")),
    ]);
    expect(issues.map((issue) => issue.code)).toContain("PRECEDENCE_FAMILY_MISMATCH");
  });

  it("rejects a precedence target that is not part of the bundle", () => {
    const issues = validatePrecedenceGraph([
      rule("r.a", procedurePayload("synthetic.p"), {
        precedence: [{ relation: "OVERRIDES", overRuleId: id("r.missing") }],
      }),
    ]);
    expect(issues.map((issue) => issue.code)).toContain("PRECEDENCE_TARGET_MISSING");
  });

  it("allows precedence between two classification rules of the same slot family", () => {
    expect(
      validatePrecedenceGraph([
        rule("r.a", caseTypePayload(A, alwaysTrue), {
          precedence: [{ relation: "EXCEPTION_TO", overRuleId: id("r.b") }],
        }),
        rule("r.b", caseTypePayload(B)),
      ]),
    ).toEqual([]);
  });
});
