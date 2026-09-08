import type { DecisionProvenance } from "../evaluation/provenance";

/**
 * Case types (Phase 2, final list).
 *
 * `TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED` exists because of a real,
 * unresolved research conflict: the Identificaciones page is titled for both
 * temporal and permanent residents but its published document list names
 * permanent-residence documents. The engine models that as a case type of its
 * own rather than guessing a temporal document set.
 */
export type CaseType =
  | "STANDARD_FIRST_CEDULA_FROM_NONE"
  | "STANDARD_FIRST_CEDULA_FROM_TEMPORAL"
  | "STANDARD_FIRST_CEDULA_FROM_PERMANENT"
  | "RESIDENCE_CLASSIFICATION_REQUIRED"
  | "RESIDENCE_STATUS_REVIEW_REQUIRED"
  | "TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED"
  | "SPECIAL_CASE"
  | "COUNTRY_NOT_SUPPORTED"
  | "NOT_FIRST_CEDULA";

export const CASE_TYPES: readonly CaseType[] = [
  "STANDARD_FIRST_CEDULA_FROM_NONE",
  "STANDARD_FIRST_CEDULA_FROM_TEMPORAL",
  "STANDARD_FIRST_CEDULA_FROM_PERMANENT",
  "RESIDENCE_CLASSIFICATION_REQUIRED",
  "RESIDENCE_STATUS_REVIEW_REQUIRED",
  "TEMPORAL_IDENTIFICACIONES_VERIFICATION_REQUIRED",
  "SPECIAL_CASE",
  "COUNTRY_NOT_SUPPORTED",
  "NOT_FIRST_CEDULA",
];

export type ClassificationStatus =
  | "COMPLETE"
  | "COMPLETE_WITH_WARNINGS"
  | "NEEDS_USER_INFORMATION"
  | "NEEDS_OFFICIAL_VERIFICATION"
  | "UNSUPPORTED";

export const CLASSIFICATION_STATUSES: readonly ClassificationStatus[] = [
  "COMPLETE",
  "COMPLETE_WITH_WARNINGS",
  "NEEDS_USER_INFORMATION",
  "NEEDS_OFFICIAL_VERIFICATION",
  "UNSUPPORTED",
];

/**
 * `caseType` is nullable on purpose. When the engine cannot authoritatively
 * classify a case it says so with `null` - it never invents a placeholder type.
 *
 * Invariant (enforced in `case-engine/evaluate`): for COMPLETE,
 * COMPLETE_WITH_WARNINGS and UNSUPPORTED a case type must be present.
 */
export type CaseClassification = Readonly<{
  caseType: CaseType | null;
  status: ClassificationStatus;
  /**
   * Why the case landed on this type and status.
   *
   * A closed vocabulary rather than free text, so the reason can be shown,
   * translated and tested. It is the difference between "we cannot classify
   * this" and "we cannot classify this *because* nobody has researched your
   * country yet".
   */
  reasonCodes: readonly CaseClassificationReasonCode[];
  /** Which rules, policies and coverage statements produced the outcome. */
  provenance: DecisionProvenance;
}>;

/** Why a case carries the type and status it does. */
export type CaseClassificationReasonCode =
  | "CLASSIFIED_BY_RULE"
  | "NO_RULE_CLASSIFIED_THE_CASE"
  | "PREVIOUS_CEDULA_DECLARED"
  | "PROCEDURE_OUT_OF_PRODUCT_SCOPE"
  | "COUNTRY_OUT_OF_PRODUCT_SCOPE"
  | "SPECIAL_CASE_BYPASS"
  | "PRODUCT_POLICY_DECLINED"
  | "USER_INFORMATION_MISSING"
  | "OFFICIAL_VERIFICATION_OPEN";

export const CASE_CLASSIFICATION_REASON_CODES: readonly CaseClassificationReasonCode[] = [
  "CLASSIFIED_BY_RULE",
  "NO_RULE_CLASSIFIED_THE_CASE",
  "PREVIOUS_CEDULA_DECLARED",
  "PROCEDURE_OUT_OF_PRODUCT_SCOPE",
  "COUNTRY_OUT_OF_PRODUCT_SCOPE",
  "SPECIAL_CASE_BYPASS",
  "PRODUCT_POLICY_DECLINED",
  "USER_INFORMATION_MISSING",
  "OFFICIAL_VERIFICATION_OPEN",
];

export function caseTypeIsTerminalUnsupported(caseType: CaseType): boolean {
  return caseType === "COUNTRY_NOT_SUPPORTED" || caseType === "NOT_FIRST_CEDULA";
}
