import { ok, type Result } from "../../shared/result/result";
import type {
  EvaluationContext,
  EvaluationExecutionContext,
} from "../../domain/evaluation/context";
import type { EngineError } from "../errors/engine-error";
import { deriveEffectiveLocalDate } from "./calendar";

/**
 * The only sanctioned way to build an `EvaluationExecutionContext`.
 *
 * `effectiveLocalDate` is derived exactly once here. Nothing downstream may
 * re-derive it, and nothing may read a clock, which is what makes an
 * evaluation reproducible from its stored inputs.
 */
export function createEvaluationExecutionContext(
  evaluation: EvaluationContext,
): Result<EvaluationExecutionContext, EngineError> {
  const derived = deriveEffectiveLocalDate(
    evaluation.evaluatedAt,
    evaluation.jurisdictionTimeZone,
  );
  if (!derived.ok) {
    return derived;
  }
  return ok({ evaluation, effectiveLocalDate: derived.value });
}
