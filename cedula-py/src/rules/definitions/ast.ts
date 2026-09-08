import type { LocalDate } from "../../domain/primitives/local-date";
import type { KnowledgeState } from "../../domain/case/knowledge";
import type { RuleFactPath } from "./fact-paths";

/**
 * The rule condition language.
 *
 * This is a *closed* union of eight node kinds. There is no escape hatch: no
 * JavaScript, no SQL, no JSONPath, no regular-expression DSL, no arithmetic
 * expression language, no callbacks. A persisted rule is data that this
 * evaluator interprets - it is never code that the runtime executes.
 */
export type TruthValue = "TRUE" | "FALSE" | "INDETERMINATE";

export const TRUTH_VALUES: readonly TruthValue[] = ["TRUE", "FALSE", "INDETERMINATE"];

/** Comparison operators, deliberately few and total. */
export type CompareOperator =
  | "EQ"
  | "NEQ"
  | "IN"
  | "NOT_IN"
  | "CONTAINS_ANY"
  | "CONTAINS_ALL"
  | "COUNT_EQ"
  | "COUNT_GTE"
  | "COUNT_LTE";

export const COMPARE_OPERATORS: readonly CompareOperator[] = [
  "EQ",
  "NEQ",
  "IN",
  "NOT_IN",
  "CONTAINS_ANY",
  "CONTAINS_ALL",
  "COUNT_EQ",
  "COUNT_GTE",
  "COUNT_LTE",
];

export type CompareOperand =
  | Readonly<{ kind: "STRING"; value: string }>
  | Readonly<{ kind: "BOOLEAN"; value: boolean }>
  | Readonly<{ kind: "INTEGER"; value: number }>
  | Readonly<{ kind: "STRING_SET"; values: readonly string[] }>;

export type DateCompareOperator = "BEFORE" | "ON_OR_BEFORE" | "ON" | "ON_OR_AFTER" | "AFTER";

export const DATE_COMPARE_OPERATORS: readonly DateCompareOperator[] = [
  "BEFORE",
  "ON_OR_BEFORE",
  "ON",
  "ON_OR_AFTER",
  "AFTER",
];

/** A calendar period. Never milliseconds - legal deadlines are calendrical. */
export type CalendarPeriod = Readonly<{
  years: number;
  months: number;
  days: number;
}>;

/**
 * Date expressions.
 *
 * `EFFECTIVE_DATE` resolves to `EvaluationExecutionContext.effectiveLocalDate`,
 * which is the single legal cut-off date of the evaluation. The engine never
 * calls a clock.
 */
export type DateExpression =
  | Readonly<{ kind: "EFFECTIVE_DATE" }>
  | Readonly<{ kind: "LITERAL_DATE"; value: LocalDate }>
  | Readonly<{ kind: "FACT_DATE"; path: RuleFactPath }>
  | Readonly<{
      kind: "SHIFTED";
      base: DateExpression;
      direction: "PLUS" | "MINUS";
      period: CalendarPeriod;
    }>;

export type RuleConditionNode =
  | Readonly<{ kind: "CONSTANT"; value: TruthValue }>
  | Readonly<{ kind: "ALL"; children: readonly RuleConditionNode[] }>
  | Readonly<{ kind: "ANY"; children: readonly RuleConditionNode[] }>
  | Readonly<{ kind: "NOT"; child: RuleConditionNode }>
  /**
   * Tests the *knowledge state* of a fact. Total by construction: it answers
   * TRUE or FALSE, never INDETERMINATE, which is what makes it usable as a
   * guard around facts that may be NOT_APPLICABLE.
   */
  | Readonly<{ kind: "FACT_STATE"; path: RuleFactPath; states: readonly KnowledgeState[] }>
  | Readonly<{
      kind: "COMPARE";
      path: RuleFactPath;
      operator: CompareOperator;
      operand: CompareOperand;
    }>
  | Readonly<{
      kind: "DATE_COMPARE";
      left: DateExpression;
      operator: DateCompareOperator;
      right: DateExpression;
    }>
  | Readonly<{
      kind: "INTERVAL_OVERLAP_AT_LEAST";
      fromPath: RuleFactPath;
      /** `toPath` may resolve to NOT_APPLICABLE, meaning an ongoing interval. */
      toPath: RuleFactPath;
      /** Optional window the interval is intersected with before measuring. */
      within: Readonly<{ from: DateExpression; to: DateExpression }> | null;
      atLeast: CalendarPeriod;
    }>;

export type RuleConditionNodeKind = RuleConditionNode["kind"];

export const RULE_CONDITION_NODE_KINDS: readonly RuleConditionNodeKind[] = [
  "CONSTANT",
  "ALL",
  "ANY",
  "NOT",
  "FACT_STATE",
  "COMPARE",
  "DATE_COMPARE",
  "INTERVAL_OVERLAP_AT_LEAST",
];
