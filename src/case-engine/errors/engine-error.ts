import type { RuleId } from "../../domain/identifiers/identifiers";

/**
 * The engine's closed error union.
 *
 * Three kinds, each with a closed set of structured codes. Business outcomes
 * are never errors: NEEDS_USER_INFORMATION, NEEDS_OFFICIAL_VERIFICATION,
 * UNSUPPORTED, STRONG_EVIDENCE and REUSE_UNKNOWN all travel inside a
 * successful decision.
 */
export type RuleConfigurationErrorCode =
  | "UNKNOWN_FACT_PATH"
  | "UNGUARDED_NOT_APPLICABLE"
  | "TARGET_MISSING"
  | "TARGET_AMBIGUOUS"
  | "DECISION_CONFLICT"
  | "PRECEDENCE_CYCLE"
  | "DEPENDENCY_SELF_LOOP"
  | "DEPENDENCY_CYCLE"
  | "PATHWAY_MISSING"
  | "PATHWAY_AMBIGUOUS"
  | "PATHWAY_VIOLATES_DEPENDENCIES"
  | "PARAMETER_FACT_UNRESOLVED"
  | "UNSUPPORTED_SCOPE_FOR_FAMILY";

export type EngineInvariantViolationCode =
  | "BUNDLE_EFFECTIVE_DATE_MISMATCH"
  | "DERIVED_KEY_FORMAT_MISMATCH"
  | "MISSING_BLOCKING_ISSUE_MAPPING"
  | "CASE_TYPE_INVARIANT_VIOLATED"
  | "UNREACHABLE_STATE";

export type RuleEvaluationErrorCode =
  | "MONEY_OVERFLOW"
  | "INVALID_DATE_EXPRESSION"
  | "INVALID_INTERVAL"
  | "INVALID_CALENDAR_PERIOD";

export type EngineError =
  | Readonly<{
      kind: "RULE_CONFIGURATION_ERROR";
      code: RuleConfigurationErrorCode;
      detail: string;
      ruleId: RuleId | null;
    }>
  | Readonly<{
      kind: "ENGINE_INVARIANT_VIOLATION";
      code: EngineInvariantViolationCode;
      detail: string;
      ruleId: RuleId | null;
    }>
  | Readonly<{
      kind: "RULE_EVALUATION_ERROR";
      code: RuleEvaluationErrorCode;
      detail: string;
      ruleId: RuleId | null;
    }>;

export function ruleConfigurationError(
  code: RuleConfigurationErrorCode,
  detail: string,
  ruleId: RuleId | null = null,
): EngineError {
  return { kind: "RULE_CONFIGURATION_ERROR", code, detail, ruleId };
}

export function engineInvariantViolation(
  code: EngineInvariantViolationCode,
  detail: string,
  ruleId: RuleId | null = null,
): EngineError {
  return { kind: "ENGINE_INVARIANT_VIOLATION", code, detail, ruleId };
}

export function ruleEvaluationError(
  code: RuleEvaluationErrorCode,
  detail: string,
  ruleId: RuleId | null = null,
): EngineError {
  return { kind: "RULE_EVALUATION_ERROR", code, detail, ruleId };
}
