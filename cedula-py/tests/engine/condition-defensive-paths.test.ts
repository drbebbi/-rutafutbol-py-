import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../../src/case-engine/conditions/evaluate-condition";
import { projectRuleFactView } from "../../src/case-engine/classify/fact-view";
import type { RuleConditionNode, DateExpression } from "../../src/rules/definitions/ast";
import type { RuleFactPath } from "../../src/rules/definitions/fact-paths";
import { knownFact, unansweredFact, unknownFact } from "../../src/domain/case/knowledge";
import { country, userCaseFacts } from "../fixtures/facts";
import { executionContext } from "../fixtures/engine";

const context = executionContext();
const view = projectRuleFactView(userCaseFacts(), context);

/**
 * A path the registry does not know. Reachable only by bypassing publication
 * validation, which is precisely why the evaluator refuses instead of guessing.
 */
const UNREGISTERED = "case.favouriteColour" as RuleFactPath;

function evaluate(node: RuleConditionNode, binding = null, factView = view) {
  return evaluateCondition(node, factView, binding, context);
}

describe("unregistered and unbound paths", () => {
  it("refuses a comparison against an unregistered path", () => {
    const result = evaluate({
      kind: "COMPARE",
      path: UNREGISTERED,
      operator: "EQ",
      operand: { kind: "STRING", value: "x" },
    });
    expect(!result.ok && result.error.code).toBe("UNKNOWN_FACT_PATH");
  });

  it("refuses a knowledge-state test against an unregistered path", () => {
    const result = evaluate({ kind: "FACT_STATE", path: UNREGISTERED, states: ["KNOWN"] });
    expect(!result.ok && result.error.code).toBe("UNKNOWN_FACT_PATH");
  });

  it("refuses a date expression against an unregistered path", () => {
    const result = evaluate({
      kind: "DATE_COMPARE",
      left: { kind: "FACT_DATE", path: UNREGISTERED },
      operator: "ON",
      right: { kind: "EFFECTIVE_DATE" },
    });
    expect(!result.ok && result.error.code).toBe("UNKNOWN_FACT_PATH");
  });

  it("refuses a right-hand date expression against an unregistered path", () => {
    const result = evaluate({
      kind: "DATE_COMPARE",
      left: { kind: "EFFECTIVE_DATE" },
      operator: "ON",
      right: { kind: "FACT_DATE", path: UNREGISTERED },
    });
    expect(!result.ok && result.error.code).toBe("UNKNOWN_FACT_PATH");
  });

  it("refuses a scoped path that is not bound in the supplied scope", () => {
    const nationalities = view.nationalities;
    if (nationalities.state !== "KNOWN") {
      throw new Error("expected known");
    }
    const result = evaluate(
      {
        kind: "COMPARE",
        path: "scope.document.readinessStatus",
        operator: "EQ",
        operand: { kind: "STRING", value: "OBTAINED" },
      },
      nationalities.entries[0] as never,
    );
    expect(!result.ok && result.error.code).toBe("UNKNOWN_FACT_PATH");
  });

  it("refuses a case path the projection does not carry", () => {
    const brokenView = {
      ...view,
      caseCells: new Map([...view.caseCells].filter(([path]) => path !== "case.adultStatus")),
    };
    const result = evaluate(
      { kind: "FACT_STATE", path: "case.adultStatus", states: ["KNOWN"] },
      null,
      brokenView,
    );
    expect(!result.ok && result.error.code).toBe("UNKNOWN_FACT_PATH");
  });

  it("propagates an error out of NOT, ALL and ANY", () => {
    const bad: RuleConditionNode = {
      kind: "COMPARE",
      path: UNREGISTERED,
      operator: "EQ",
      operand: { kind: "STRING", value: "x" },
    };
    expect(evaluate({ kind: "NOT", child: bad }).ok).toBe(false);
    expect(evaluate({ kind: "ALL", children: [bad] }).ok).toBe(false);
    expect(evaluate({ kind: "ANY", children: [bad] }).ok).toBe(false);
  });
});

describe("date expression failures", () => {
  it("propagates an unregistered path through a shifted expression", () => {
    const shifted: DateExpression = {
      kind: "SHIFTED",
      base: { kind: "FACT_DATE", path: UNREGISTERED },
      direction: "PLUS",
      period: { years: 1, months: 0, days: 0 },
    };
    expect(evaluate({ kind: "DATE_COMPARE", left: shifted, operator: "ON", right: { kind: "EFFECTIVE_DATE" } }).ok).toBe(false);
  });

  it("refuses a malformed calendar period inside a shifted expression", () => {
    const shifted: DateExpression = {
      kind: "SHIFTED",
      base: { kind: "EFFECTIVE_DATE" },
      direction: "PLUS",
      period: { years: -1, months: 0, days: 0 },
    };
    const result = evaluate({
      kind: "DATE_COMPARE",
      left: shifted,
      operator: "ON",
      right: { kind: "EFFECTIVE_DATE" },
    });
    expect(!result.ok && result.error.code).toBe("INVALID_CALENDAR_PERIOD");
  });
});

describe("interval failures and indeterminacy", () => {
  const scopedView = () => {
    const facts = userCaseFacts({
      residenceHistory: knownFact([
        { countryCode: country("PY"), from: "2024-01-01" as never, to: null },
      ]),
      residence: {
        reportedType: knownFact("NONE"),
        card: { state: knownFact("NOT_HELD"), expiryDate: unknownFact },
      },
    });
    return projectRuleFactView(facts, context);
  };

  it("refuses an unregistered from-path", () => {
    const result = evaluate({
      kind: "INTERVAL_OVERLAP_AT_LEAST",
      fromPath: UNREGISTERED,
      toPath: "case.residence.card.expiryDate",
      within: null,
      atLeast: { years: 1, months: 0, days: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("is indeterminate when the from-date is not known", () => {
    const result = evaluate(
      {
        kind: "INTERVAL_OVERLAP_AT_LEAST",
        fromPath: "case.residence.card.expiryDate",
        toPath: "case.residence.card.expiryDate",
        within: null,
        atLeast: { years: 1, months: 0, days: 0 },
      },
      null,
      scopedView(),
    );
    expect(result.ok && result.value.value).toBe("INDETERMINATE");
    expect(result.ok && result.value.indeterminateFactPaths).toContain("case.residence.card.expiryDate");
  });

  it("refuses an unregistered to-path", () => {
    const result = evaluate({
      kind: "INTERVAL_OVERLAP_AT_LEAST",
      fromPath: "context.effectiveLocalDate",
      toPath: UNREGISTERED,
      within: null,
      atLeast: { years: 1, months: 0, days: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("is indeterminate when the to-date is unanswered rather than ongoing", () => {
    const facts = userCaseFacts({
      residence: {
        reportedType: knownFact("NONE"),
        card: { state: knownFact("NOT_HELD"), expiryDate: unansweredFact },
      },
    });
    const result = evaluate(
      {
        kind: "INTERVAL_OVERLAP_AT_LEAST",
        fromPath: "context.effectiveLocalDate",
        toPath: "case.residence.card.expiryDate",
        within: null,
        atLeast: { years: 0, months: 0, days: 1 },
      },
      null,
      projectRuleFactView(facts, context),
    );
    expect(result.ok && result.value.value).toBe("INDETERMINATE");
  });

  it("refuses an inverted interval", () => {
    const facts = userCaseFacts({
      residence: {
        reportedType: knownFact("NONE"),
        card: { state: knownFact("NOT_HELD"), expiryDate: knownFact("2000-01-01" as never) },
      },
    });
    const result = evaluate(
      {
        kind: "INTERVAL_OVERLAP_AT_LEAST",
        fromPath: "context.effectiveLocalDate",
        toPath: "case.residence.card.expiryDate",
        within: null,
        atLeast: { years: 0, months: 0, days: 1 },
      },
      null,
      projectRuleFactView(facts, context),
    );
    expect(!result.ok && result.error.code).toBe("INVALID_INTERVAL");
  });

  it("propagates a failure from either end of the window", () => {
    const base = {
      kind: "INTERVAL_OVERLAP_AT_LEAST" as const,
      fromPath: "context.effectiveLocalDate" as RuleFactPath,
      toPath: "context.effectiveLocalDate" as RuleFactPath,
      atLeast: { years: 0, months: 0, days: 1 },
    };
    const badExpression: DateExpression = { kind: "FACT_DATE", path: UNREGISTERED };
    expect(
      evaluate({ ...base, within: { from: badExpression, to: { kind: "EFFECTIVE_DATE" } } }).ok,
    ).toBe(false);
    expect(
      evaluate({ ...base, within: { from: { kind: "EFFECTIVE_DATE" }, to: badExpression } }).ok,
    ).toBe(false);
  });

  it("refuses an inverted window", () => {
    const result = evaluate({
      kind: "INTERVAL_OVERLAP_AT_LEAST",
      fromPath: "context.effectiveLocalDate",
      toPath: "context.effectiveLocalDate",
      within: {
        from: { kind: "LITERAL_DATE", value: "2026-06-15" as never },
        to: { kind: "LITERAL_DATE", value: "2020-01-01" as never },
      },
      atLeast: { years: 0, months: 0, days: 1 },
    });
    expect(!result.ok && result.error.code).toBe("INVALID_INTERVAL");
  });
});
