import { describe, expect, it } from "vitest";
import { evaluateCondition, collectGuardedPaths } from "../../src/case-engine/conditions/evaluate-condition";
import { projectRuleFactView } from "../../src/case-engine/classify/fact-view";
import type { RuleConditionNode } from "../../src/rules/definitions/ast";
import { knownFact, unansweredFact, unknownFact } from "../../src/domain/case/knowledge";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { userCaseFacts, country, unansweredSpecialCase } from "../fixtures/facts";
import { executionContext } from "../fixtures/engine";
import type { UserCaseFacts } from "../../src/domain/case/user-case-facts";

const context = executionContext();

function evaluate(node: RuleConditionNode, facts: UserCaseFacts = userCaseFacts()) {
  const view = projectRuleFactView(facts, context);
  return unwrapOrThrow(evaluateCondition(node, view, null, context));
}

function evaluateScoped(node: RuleConditionNode, scope: "nationalities" | "residenceHistory" | "documents", index: number, facts: UserCaseFacts = userCaseFacts()) {
  const view = projectRuleFactView(facts, context);
  const collection = view[scope];
  if (collection.state !== "KNOWN") {
    throw new Error("collection is not known");
  }
  return unwrapOrThrow(evaluateCondition(node, view, collection.entries[index] ?? null, context));
}

describe("FACT_STATE", () => {
  it("is total: it answers TRUE or FALSE, never INDETERMINATE", () => {
    expect(evaluate({ kind: "FACT_STATE", path: "case.adultStatus", states: ["KNOWN"] }).value).toBe("TRUE");
    expect(evaluate({ kind: "FACT_STATE", path: "case.adultStatus", states: ["UNKNOWN"] }).value).toBe("FALSE");

    const unanswered = userCaseFacts({ adultStatus: unansweredFact });
    expect(
      evaluate({ kind: "FACT_STATE", path: "case.adultStatus", states: ["UNANSWERED", "UNKNOWN"] }, unanswered).value,
    ).toBe("TRUE");
  });

  it("counts as guarding the path", () => {
    const guarded = collectGuardedPaths({
      kind: "ALL",
      children: [
        { kind: "NOT", child: { kind: "FACT_STATE", path: "case.maritalStatus", states: ["KNOWN"] } },
        { kind: "ANY", children: [{ kind: "CONSTANT", value: "TRUE" }] },
      ],
    });
    expect([...guarded]).toEqual(["case.maritalStatus"]);
  });
});

describe("COMPARE", () => {
  it("treats UNKNOWN and UNANSWERED as INDETERMINATE, never as false", () => {
    for (const fact of [unknownFact, unansweredFact]) {
      const facts = userCaseFacts({ maritalStatus: fact });
      const outcome = evaluate(
        { kind: "COMPARE", path: "case.maritalStatus", operator: "EQ", operand: { kind: "STRING", value: "MARRIED" } },
        facts,
      );
      expect(outcome.value).toBe("INDETERMINATE");
      expect(outcome.indeterminateFactPaths).toEqual(["case.maritalStatus"]);
    }
  });

  it("compares strings, sets and counts", () => {
    expect(
      evaluate({ kind: "COMPARE", path: "case.adultStatus", operator: "EQ", operand: { kind: "STRING", value: "ADULT" } }).value,
    ).toBe("TRUE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.adultStatus", operator: "NEQ", operand: { kind: "STRING", value: "ADULT" } }).value,
    ).toBe("FALSE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.adultStatus", operator: "IN", operand: { kind: "STRING_SET", values: ["ADULT", "MINOR"] } }).value,
    ).toBe("TRUE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.adultStatus", operator: "NOT_IN", operand: { kind: "STRING_SET", values: ["MINOR"] } }).value,
    ).toBe("TRUE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.citizenshipCountries", operator: "CONTAINS_ANY", operand: { kind: "STRING_SET", values: ["DE", "FR"] } }).value,
    ).toBe("TRUE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.citizenshipCountries", operator: "CONTAINS_ALL", operand: { kind: "STRING_SET", values: ["DE", "FR"] } }).value,
    ).toBe("FALSE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.citizenshipCount", operator: "COUNT_EQ", operand: { kind: "INTEGER", value: 1 } }).value,
    ).toBe("TRUE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.citizenshipCount", operator: "COUNT_GTE", operand: { kind: "INTEGER", value: 2 } }).value,
    ).toBe("FALSE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.citizenshipCount", operator: "COUNT_LTE", operand: { kind: "INTEGER", value: 1 } }).value,
    ).toBe("TRUE");
    expect(
      evaluate({ kind: "COMPARE", path: "case.holdsPreviousParaguayanCedula", operator: "EQ", operand: { kind: "BOOLEAN", value: false } }).value,
    ).toBe("TRUE");
  });

  it("records an unguarded NOT_APPLICABLE separately from a plain unknown", () => {
    const abroadWithoutCountry = userCaseFacts({
      location: knownFact({ kind: "ABROAD", countryCode: null }),
    });
    const outcome = evaluate(
      { kind: "COMPARE", path: "case.location.countryCode", operator: "EQ", operand: { kind: "STRING", value: "DE" } },
      abroadWithoutCountry,
    );
    expect(outcome.value).toBe("INDETERMINATE");
    expect(outcome.unguardedNotApplicablePaths).toEqual(["case.location.countryCode"]);

    const guarded = evaluate(
      {
        kind: "ALL",
        children: [
          { kind: "FACT_STATE", path: "case.location.countryCode", states: ["KNOWN"] },
          { kind: "COMPARE", path: "case.location.countryCode", operator: "EQ", operand: { kind: "STRING", value: "DE" } },
        ],
      },
      abroadWithoutCountry,
    );
    expect(guarded.value).toBe("FALSE");
    expect(guarded.unguardedNotApplicablePaths).toEqual([]);
  });
});

describe("DATE_COMPARE", () => {
  it("compares against the effective date and shifted expressions", () => {
    expect(
      evaluate({
        kind: "DATE_COMPARE",
        left: { kind: "FACT_DATE", path: "case.residence.card.expiryDate" },
        operator: "AFTER",
        right: { kind: "EFFECTIVE_DATE" },
      }).value,
    ).toBe("TRUE");

    expect(
      evaluate({
        kind: "DATE_COMPARE",
        left: { kind: "EFFECTIVE_DATE" },
        operator: "ON",
        right: { kind: "LITERAL_DATE", value: "2026-06-15" as never },
      }).value,
    ).toBe("TRUE");

    expect(
      evaluate({
        kind: "DATE_COMPARE",
        left: { kind: "SHIFTED", base: { kind: "EFFECTIVE_DATE" }, direction: "MINUS", period: { years: 1, months: 0, days: 0 } },
        operator: "ON",
        right: { kind: "LITERAL_DATE", value: "2025-06-15" as never },
      }).value,
    ).toBe("TRUE");

    for (const operator of ["BEFORE", "ON_OR_BEFORE", "ON_OR_AFTER"] as const) {
      expect(
        evaluate({
          kind: "DATE_COMPARE",
          left: { kind: "EFFECTIVE_DATE" },
          operator,
          right: { kind: "EFFECTIVE_DATE" },
        }).value,
      ).toBe(operator === "BEFORE" ? "FALSE" : "TRUE");
    }
  });

  it("is indeterminate when a date fact is not known", () => {
    const facts = userCaseFacts({
      residence: { reportedType: knownFact("TEMPORAL"), card: { state: knownFact("HELD_VALID"), expiryDate: unknownFact } },
    });
    const outcome = evaluate(
      {
        kind: "DATE_COMPARE",
        left: { kind: "FACT_DATE", path: "case.residence.card.expiryDate" },
        operator: "AFTER",
        right: { kind: "EFFECTIVE_DATE" },
      },
      facts,
    );
    expect(outcome.value).toBe("INDETERMINATE");
    expect(outcome.indeterminateFactPaths).toEqual(["case.residence.card.expiryDate"]);
  });
});

describe("INTERVAL_OVERLAP_AT_LEAST", () => {
  const node = (years: number): RuleConditionNode => ({
    kind: "INTERVAL_OVERLAP_AT_LEAST",
    fromPath: "scope.residenceHistory.from",
    toPath: "scope.residenceHistory.to",
    within: null,
    atLeast: { years, months: 0, days: 0 },
  });

  it("treats an ongoing stay as running to the effective date inclusive", () => {
    // 2024-01-01 .. 2026-06-15 inclusive is more than two years.
    expect(evaluateScoped(node(2), "residenceHistory", 0).value).toBe("TRUE");
    expect(evaluateScoped(node(3), "residenceHistory", 0).value).toBe("FALSE");
  });

  it("intersects with an explicit window", () => {
    const withWindow: RuleConditionNode = {
      kind: "INTERVAL_OVERLAP_AT_LEAST",
      fromPath: "scope.residenceHistory.from",
      toPath: "scope.residenceHistory.to",
      within: {
        from: { kind: "SHIFTED", base: { kind: "EFFECTIVE_DATE" }, direction: "MINUS", period: { years: 1, months: 0, days: 0 } },
        to: { kind: "EFFECTIVE_DATE" },
      },
      atLeast: { years: 1, months: 0, days: 0 },
    };
    expect(evaluateScoped(withWindow, "residenceHistory", 0).value).toBe("TRUE");

    const noOverlap: RuleConditionNode = {
      ...withWindow,
      within: {
        from: { kind: "LITERAL_DATE", value: "2000-01-01" as never },
        to: { kind: "LITERAL_DATE", value: "2001-01-01" as never },
      },
    };
    expect(evaluateScoped(noOverlap, "residenceHistory", 0).value).toBe("FALSE");
  });

  it("is indeterminate when the end date is unknown rather than ongoing", () => {
    const facts = userCaseFacts({ residenceHistory: unknownFact });
    const view = projectRuleFactView(facts, context);
    expect(view.residenceHistory.state).toBe("UNKNOWN");
  });
});

describe("scope collections", () => {
  it("does not treat an unknown collection as an empty one", () => {
    const facts = userCaseFacts({ nationalities: unknownFact });
    const view = projectRuleFactView(facts, context);
    expect(view.nationalities.state).toBe("UNKNOWN");
    expect(view.caseCells.get("case.citizenshipCountries")?.state).toBe("UNKNOWN");
    expect(view.caseCells.get("case.citizenshipCount")?.state).toBe("UNKNOWN");
  });

  it("sorts collection entries canonically", () => {
    const facts = userCaseFacts({
      nationalities: knownFact([
        { countryCode: country("IT"), roles: ["CITIZENSHIP"] },
        { countryCode: country("AT"), roles: ["PROCESS_TRAVEL_DOCUMENT", "CITIZENSHIP"] },
      ]),
    });
    const view = projectRuleFactView(facts, context);
    if (view.nationalities.state !== "KNOWN") {
      throw new Error("expected known");
    }
    expect(view.nationalities.entries[0]?.get("scope.nationality.countryCode")).toEqual({
      state: "KNOWN",
      value: "AT",
    });
    expect(view.nationalities.entries[0]?.get("scope.nationality.roles")).toEqual({
      state: "KNOWN",
      value: ["CITIZENSHIP", "PROCESS_TRAVEL_DOCUMENT"],
    });
  });

  it("exposes special-case answers and readiness separately", () => {
    const facts = userCaseFacts({ specialCase: unansweredSpecialCase });
    const view = projectRuleFactView(facts, context);
    expect(view.caseCells.get("case.specialCase.paraguayanCitizenship")?.state).toBe("UNANSWERED");
    expect(view.caseCells.get("case.entryEvidence.state")).toEqual({
      state: "KNOWN",
      value: "STAMP_AVAILABLE",
    });
  });
});

describe("scope binding errors", () => {
  it("refuses to read a scoped path without a binding", () => {
    const view = projectRuleFactView(userCaseFacts(), context);
    const result = evaluateCondition(
      { kind: "COMPARE", path: "scope.nationality.countryCode", operator: "EQ", operand: { kind: "STRING", value: "DE" } },
      view,
      null,
      context,
    );
    expect(result.ok).toBe(false);
  });
});
