import type { UserCaseFacts } from "../../src/domain/case/user-case-facts";
import type { RuleRevision } from "../../src/rules/definitions/rule-revision";
import type { CaseEvaluationDecision } from "../../src/domain/evaluation/decision";
import type { EngineError } from "../../src/case-engine/errors/engine-error";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import { JURISDICTION_TIME_ZONE } from "../../src/domain/primitives/time-zone";
import { createEvaluationExecutionContext } from "../../src/case-engine/date-math/execution-context";
import { evaluateCase } from "../../src/case-engine/evaluate/evaluate-case";
import { unwrapOrThrow, type Result } from "../../src/shared/result/result";
import type { InstantString } from "../../src/domain/primitives/instant";
import { engineReadyBundle, type BundleExtras } from "./rules";

export const DEFAULT_INSTANT = "2026-06-15T12:00:00Z" as InstantString;
export const DEFAULT_EFFECTIVE_LOCAL_DATE = "2026-06-15";

export function executionContext(evaluatedAt: InstantString = DEFAULT_INSTANT) {
  return unwrapOrThrow(
    createEvaluationExecutionContext({
      evaluatedAt,
      jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
    }),
  );
}

export function runEngine(
  facts: UserCaseFacts,
  rules: readonly RuleRevision[],
  extras: BundleExtras = {},
  evaluatedAt: InstantString = DEFAULT_INSTANT,
): Result<CaseEvaluationDecision, EngineError> {
  const context = executionContext(evaluatedAt);
  const bundle = engineReadyBundle(rules, context.effectiveLocalDate as string, extras);
  return evaluateCase(facts, context, bundle, CURRENT_ENGINE_DESCRIPTOR);
}

export function expectOk(result: Result<CaseEvaluationDecision, EngineError>): CaseEvaluationDecision {
  if (!result.ok) {
    throw new Error(`expected a decision, got ${result.error.kind}/${result.error.code}: ${result.error.detail}`);
  }
  return result.value;
}

export function expectErr(result: Result<CaseEvaluationDecision, EngineError>): EngineError {
  if (result.ok) {
    throw new Error("expected an engine error, got a decision");
  }
  return result.error;
}
