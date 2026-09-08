import { err, ok, type Result } from "../../shared/result/result";
import type { RuleId } from "../../domain/identifiers/identifiers";
import type { TruthValue } from "../../rules/definitions/ast";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";

export type TargetOutcomeState =
  | "MATCHED"
  | "NEGATIVELY_RESOLVED"
  | "MISSING"
  | "AMBIGUOUS"
  | "UNRESOLVED_TEMPLATE";

/**
 * Turns a target resolution into "apply this rule" or "skip it".
 *
 * The asymmetry is deliberate. A rule that *asserts* something (TRUE) about a
 * target that does not exist, or that matches several targets, is a defect in
 * the knowledge base and must stop publication. The same rule while still
 * indeterminate says nothing yet, so it is merely skipped - and its
 * indeterminate facts are carried forward as possible blockers.
 */
export function classifyTargetOutcome(
  state: TargetOutcomeState,
  truth: TruthValue,
  ruleId: RuleId,
  detail: string,
): Result<"APPLY" | "SKIP", EngineError> {
  switch (state) {
    case "MATCHED":
      return ok("APPLY");
    case "NEGATIVELY_RESOLVED":
      return ok("SKIP");
    case "MISSING":
      return truth === "TRUE"
        ? err(ruleConfigurationError("TARGET_MISSING", detail, ruleId))
        : ok("SKIP");
    case "AMBIGUOUS":
      return truth === "TRUE"
        ? err(ruleConfigurationError("TARGET_AMBIGUOUS", detail, ruleId))
        : ok("SKIP");
    case "UNRESOLVED_TEMPLATE":
      return truth === "TRUE"
        ? err(ruleConfigurationError("PARAMETER_FACT_UNRESOLVED", detail, ruleId))
        : ok("SKIP");
  }
}
