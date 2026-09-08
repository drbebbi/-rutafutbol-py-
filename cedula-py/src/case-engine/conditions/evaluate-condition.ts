import { err, ok, type Result } from "../../shared/result/result";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { RuleId } from "../../domain/identifiers/identifiers";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import type {
  CompareOperand,
  CompareOperator,
  DateExpression,
  RuleConditionNode,
  TruthValue,
} from "../../rules/definitions/ast";
import { lookupFactPath, type RuleFactPath } from "../../rules/definitions/fact-paths";
import { addCalendarPeriod, compareLocalDates, coversAtLeastCalendarPeriod, intersectIntervals, toHalfOpenInterval } from "../date-math/calendar";
import { ruleConfigurationError, ruleEvaluationError, type EngineError } from "../errors/engine-error";
import type { FactCell, FactCellValue, RuleFactView, ScopeBinding } from "../classify/fact-view";
import { andAll, fromBoolean, negate, orAny } from "./three-valued";

/**
 * The result of evaluating one rule condition.
 *
 * `indeterminateFactPaths` is what later turns into blocking issues - through
 * the closed fact-dependency policy registry, never as a raw path.
 * `unguardedNotApplicablePaths` records the paths that went indeterminate
 * *because* they were NOT_APPLICABLE without the rule ever testing for it.
 */
export type ConditionOutcome = Readonly<{
  value: TruthValue;
  indeterminateFactPaths: readonly RuleFactPath[];
  unguardedNotApplicablePaths: readonly RuleFactPath[];
}>;

type Accumulator = {
  indeterminate: Set<RuleFactPath>;
  unguardedNotApplicable: Set<RuleFactPath>;
};

/**
 * Paths the rule explicitly tests with FACT_STATE anywhere in its condition.
 * Testing a path's knowledge state counts as guarding it.
 */
export function collectGuardedPaths(node: RuleConditionNode, into: Set<RuleFactPath> = new Set()): Set<RuleFactPath> {
  switch (node.kind) {
    case "FACT_STATE":
      into.add(node.path);
      return into;
    case "ALL":
    case "ANY":
      for (const child of node.children) {
        collectGuardedPaths(child, into);
      }
      return into;
    case "NOT":
      collectGuardedPaths(node.child, into);
      return into;
    case "CONSTANT":
    case "COMPARE":
    case "DATE_COMPARE":
    case "INTERVAL_OVERLAP_AT_LEAST":
      return into;
  }
}

function readCell(
  view: RuleFactView,
  binding: ScopeBinding | null,
  path: RuleFactPath,
): Result<FactCell, EngineError> {
  const descriptor = lookupFactPath(path);
  if (descriptor === null) {
    return err(ruleConfigurationError("UNKNOWN_FACT_PATH", `path "${path}" is not registered`));
  }
  if (descriptor.pathScope === "CASE" || descriptor.pathScope === "CONTEXT") {
    const cell = view.caseCells.get(path);
    if (cell === undefined) {
      return err(ruleConfigurationError("UNKNOWN_FACT_PATH", `path "${path}" is not projected`));
    }
    return ok(cell);
  }
  if (binding === null) {
    return err(
      ruleConfigurationError(
        "UNSUPPORTED_SCOPE_FOR_FAMILY",
        `path "${path}" requires a ${descriptor.pathScope} scope binding`,
      ),
    );
  }
  const cell = binding.get(path);
  if (cell === undefined) {
    return err(ruleConfigurationError("UNKNOWN_FACT_PATH", `path "${path}" is not bound in scope`));
  }
  return ok(cell);
}

function noteIndeterminate(
  acc: Accumulator,
  guarded: ReadonlySet<RuleFactPath>,
  path: RuleFactPath,
  cell: FactCell,
): void {
  acc.indeterminate.add(path);
  if (cell.state === "NOT_APPLICABLE" && !guarded.has(path)) {
    acc.unguardedNotApplicable.add(path);
  }
}

function compareScalars(
  operator: CompareOperator,
  value: FactCellValue,
  operand: CompareOperand,
): Result<TruthValue, EngineError> {
  switch (operator) {
    case "EQ":
      if (operand.kind === "STRING_SET") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "EQ does not accept a set operand"));
      }
      return ok(fromBoolean(value === operand.value));
    case "NEQ":
      if (operand.kind === "STRING_SET") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "NEQ does not accept a set operand"));
      }
      return ok(fromBoolean(value !== operand.value));
    case "IN":
      if (operand.kind !== "STRING_SET") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "IN requires a set operand"));
      }
      return ok(fromBoolean(operand.values.includes(value as string)));
    case "NOT_IN":
      if (operand.kind !== "STRING_SET") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "NOT_IN requires a set operand"));
      }
      return ok(fromBoolean(!operand.values.includes(value as string)));
    case "CONTAINS_ANY": {
      if (operand.kind !== "STRING_SET" || !Array.isArray(value)) {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "CONTAINS_ANY requires set/set"));
      }
      const set = new Set(value as readonly string[]);
      return ok(fromBoolean(operand.values.some((candidate) => set.has(candidate))));
    }
    case "CONTAINS_ALL": {
      if (operand.kind !== "STRING_SET" || !Array.isArray(value)) {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "CONTAINS_ALL requires set/set"));
      }
      const set = new Set(value as readonly string[]);
      return ok(fromBoolean(operand.values.every((candidate) => set.has(candidate))));
    }
    case "COUNT_EQ":
      if (operand.kind !== "INTEGER") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "COUNT_EQ requires an integer"));
      }
      return ok(fromBoolean((value as number) === operand.value));
    case "COUNT_GTE":
      if (operand.kind !== "INTEGER") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "COUNT_GTE requires an integer"));
      }
      return ok(fromBoolean((value as number) >= operand.value));
    case "COUNT_LTE":
      if (operand.kind !== "INTEGER") {
        return err(ruleEvaluationError("INVALID_DATE_EXPRESSION", "COUNT_LTE requires an integer"));
      }
      return ok(fromBoolean((value as number) <= operand.value));
  }
}

type DateResolution =
  | Readonly<{ state: "RESOLVED"; date: LocalDate }>
  | Readonly<{ state: "INDETERMINATE" }>;

function resolveDateExpression(
  expression: DateExpression,
  view: RuleFactView,
  binding: ScopeBinding | null,
  context: EvaluationExecutionContext,
  acc: Accumulator,
  guarded: ReadonlySet<RuleFactPath>,
): Result<DateResolution, EngineError> {
  switch (expression.kind) {
    case "EFFECTIVE_DATE":
      return ok({ state: "RESOLVED", date: context.effectiveLocalDate });
    case "LITERAL_DATE":
      return ok({ state: "RESOLVED", date: expression.value });
    case "FACT_DATE": {
      const cell = readCell(view, binding, expression.path);
      if (!cell.ok) {
        return cell;
      }
      if (cell.value.state !== "KNOWN") {
        noteIndeterminate(acc, guarded, expression.path, cell.value);
        return ok({ state: "INDETERMINATE" });
      }
      return ok({ state: "RESOLVED", date: cell.value.value as LocalDate });
    }
    case "SHIFTED": {
      const base = resolveDateExpression(expression.base, view, binding, context, acc, guarded);
      if (!base.ok) {
        return base;
      }
      if (base.value.state === "INDETERMINATE") {
        return ok({ state: "INDETERMINATE" });
      }
      const shifted = addCalendarPeriod(base.value.date, expression.period, expression.direction);
      if (!shifted.ok) {
        return shifted;
      }
      return ok({ state: "RESOLVED", date: shifted.value });
    }
  }
}

function evaluateNode(
  node: RuleConditionNode,
  view: RuleFactView,
  binding: ScopeBinding | null,
  context: EvaluationExecutionContext,
  acc: Accumulator,
  guarded: ReadonlySet<RuleFactPath>,
): Result<TruthValue, EngineError> {
  switch (node.kind) {
    case "CONSTANT":
      return ok(node.value);
    case "ALL":
    case "ANY": {
      const values: TruthValue[] = [];
      for (const child of node.children) {
        const evaluated = evaluateNode(child, view, binding, context, acc, guarded);
        if (!evaluated.ok) {
          return evaluated;
        }
        values.push(evaluated.value);
      }
      return ok(node.kind === "ALL" ? andAll(values) : orAny(values));
    }
    case "NOT": {
      const evaluated = evaluateNode(node.child, view, binding, context, acc, guarded);
      return evaluated.ok ? ok(negate(evaluated.value)) : evaluated;
    }
    case "FACT_STATE": {
      const cell = readCell(view, binding, node.path);
      if (!cell.ok) {
        return cell;
      }
      // Total by construction: a knowledge-state test always answers.
      return ok(fromBoolean(node.states.includes(cell.value.state)));
    }
    case "COMPARE": {
      const cell = readCell(view, binding, node.path);
      if (!cell.ok) {
        return cell;
      }
      if (cell.value.state !== "KNOWN") {
        noteIndeterminate(acc, guarded, node.path, cell.value);
        return ok("INDETERMINATE");
      }
      return compareScalars(node.operator, cell.value.value, node.operand);
    }
    case "DATE_COMPARE": {
      const left = resolveDateExpression(node.left, view, binding, context, acc, guarded);
      if (!left.ok) {
        return left;
      }
      const right = resolveDateExpression(node.right, view, binding, context, acc, guarded);
      if (!right.ok) {
        return right;
      }
      if (left.value.state === "INDETERMINATE" || right.value.state === "INDETERMINATE") {
        return ok("INDETERMINATE");
      }
      const comparison = compareLocalDates(left.value.date, right.value.date);
      const satisfied =
        node.operator === "BEFORE"
          ? comparison < 0
          : node.operator === "ON_OR_BEFORE"
            ? comparison <= 0
            : node.operator === "ON"
              ? comparison === 0
              : node.operator === "ON_OR_AFTER"
                ? comparison >= 0
                : comparison > 0;
      return ok(fromBoolean(satisfied));
    }
    case "INTERVAL_OVERLAP_AT_LEAST": {
      const fromCell = readCell(view, binding, node.fromPath);
      if (!fromCell.ok) {
        return fromCell;
      }
      if (fromCell.value.state !== "KNOWN") {
        noteIndeterminate(acc, guarded, node.fromPath, fromCell.value);
        return ok("INDETERMINATE");
      }
      const toCell = readCell(view, binding, node.toPath);
      if (!toCell.ok) {
        return toCell;
      }
      // NOT_APPLICABLE on the end date is the modelled "ongoing" case and is
      // handled here explicitly, so it is never an unguarded NOT_APPLICABLE.
      if (toCell.value.state === "UNKNOWN" || toCell.value.state === "UNANSWERED") {
        acc.indeterminate.add(node.toPath);
        return ok("INDETERMINATE");
      }
      const endInclusive =
        toCell.value.state === "NOT_APPLICABLE" ? null : (toCell.value.value as LocalDate);

      const interval = toHalfOpenInterval(
        fromCell.value.value as LocalDate,
        endInclusive,
        context.effectiveLocalDate,
      );
      if (!interval.ok) {
        return interval;
      }

      let measured = interval.value;
      if (node.within !== null) {
        const windowFrom = resolveDateExpression(node.within.from, view, binding, context, acc, guarded);
        if (!windowFrom.ok) {
          return windowFrom;
        }
        const windowTo = resolveDateExpression(node.within.to, view, binding, context, acc, guarded);
        if (!windowTo.ok) {
          return windowTo;
        }
        if (windowFrom.value.state === "INDETERMINATE" || windowTo.value.state === "INDETERMINATE") {
          return ok("INDETERMINATE");
        }
        const window = toHalfOpenInterval(
          windowFrom.value.date,
          windowTo.value.date,
          context.effectiveLocalDate,
        );
        if (!window.ok) {
          return window;
        }
        const intersection = intersectIntervals(measured, window.value);
        if (intersection === null) {
          return ok("FALSE");
        }
        measured = intersection;
      }

      const covers = coversAtLeastCalendarPeriod(measured, node.atLeast);
      return covers.ok ? ok(fromBoolean(covers.value)) : covers;
    }
  }
}

/**
 * Evaluates one rule condition against the fact view.
 *
 * `ruleId` is only used to attribute engine errors; it never influences the
 * result.
 */
export function evaluateCondition(
  node: RuleConditionNode,
  view: RuleFactView,
  binding: ScopeBinding | null,
  context: EvaluationExecutionContext,
  ruleId: RuleId | null = null,
): Result<ConditionOutcome, EngineError> {
  const acc: Accumulator = { indeterminate: new Set(), unguardedNotApplicable: new Set() };
  const guarded = collectGuardedPaths(node);
  const evaluated = evaluateNode(node, view, binding, context, acc, guarded);
  if (!evaluated.ok) {
    const error = evaluated.error;
    return err(ruleId === null ? error : { ...error, ruleId });
  }
  return ok({
    value: evaluated.value,
    indeterminateFactPaths: [...acc.indeterminate].sort(),
    unguardedNotApplicablePaths: [...acc.unguardedNotApplicable].sort(),
  });
}
