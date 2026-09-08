import type { BlockingIssueCode } from "../../domain/evaluation/issues";

/**
 * Rules never read `UserCaseFacts` directly. They read a projection - the
 * `RuleFactView` - through a closed registry of paths. Two things follow:
 *
 *  1. A rule cannot reach a fact that was not deliberately exposed to rules.
 *  2. Every indeterminate fact maps onto a business-meaningful blocking issue
 *     code, so the product never has to emit `MISSING_FIELD(some.internal.path)`.
 */
export type RuleFactPath =
  | "case.desiredProcedure"
  | "case.adultStatus"
  | "case.location.kind"
  | "case.location.countryCode"
  | "case.maritalStatus"
  | "case.holdsPreviousParaguayanCedula"
  | "case.residence.reportedType"
  | "case.residence.card.state"
  | "case.residence.card.expiryDate"
  | "case.entryTravelDocumentCountry"
  | "case.processTravelDocumentCountry"
  | "case.citizenshipCountries"
  | "case.citizenshipCount"
  | "case.specialCase.paraguayanCitizenship"
  | "case.specialCase.paraguayanParent"
  | "case.specialCase.paraguayanSpouse"
  | "case.specialCase.repatriadoFamily"
  | "case.specialCase.diplomaticStatus"
  | "case.specialCase.protectionStatus"
  | "case.specialCase.investorStatus"
  | "case.entryEvidence.state"
  | "context.effectiveLocalDate"
  | "scope.nationality.countryCode"
  | "scope.nationality.roles"
  | "scope.residenceHistory.countryCode"
  | "scope.residenceHistory.from"
  | "scope.residenceHistory.to"
  | "scope.document.documentTypeId"
  | "scope.document.issuingCountry"
  | "scope.document.issueDate"
  | "scope.document.expiryDate"
  | "scope.document.language"
  | "scope.document.readinessStatus";

/** What kind of value a path yields, which decides operator compatibility. */
export type RuleFactValueType = "STRING" | "BOOLEAN" | "INTEGER" | "LOCAL_DATE" | "STRING_SET";

/**
 * Fact access domains.
 *
 * CASE_LEGAL      - the applicant's legal situation.
 * DOCUMENT_STATE  - what papers the applicant already holds.
 * ENTRY_READINESS - evidence of entry the applicant can produce today.
 *
 * A legal requirement rule may only read CASE_LEGAL. That is what makes
 * "I already have my birth certificate" incapable of deleting the legal
 * requirement for a birth certificate.
 */
export type FactAccessDomain = "CASE_LEGAL" | "DOCUMENT_STATE" | "ENTRY_READINESS";

/** Which iteration a path belongs to. */
export type FactPathScope =
  | "CASE"
  | "CONTEXT"
  | "NATIONALITY"
  | "RESIDENCE_HISTORY"
  | "DOCUMENT";

export type RuleFactPathDescriptor = Readonly<{
  path: RuleFactPath;
  valueType: RuleFactValueType;
  accessDomain: FactAccessDomain;
  pathScope: FactPathScope;
  /**
   * Business code raised when this fact is decision-relevant but indeterminate.
   * `null` marks a path that is structurally always determinate; if such a path
   * is ever observed indeterminate the engine raises an invariant violation
   * rather than inventing an issue code.
   */
  blockingIssueCode: BlockingIssueCode | null;
}>;

function descriptor(
  path: RuleFactPath,
  valueType: RuleFactValueType,
  accessDomain: FactAccessDomain,
  pathScope: FactPathScope,
  blockingIssueCode: BlockingIssueCode | null,
): RuleFactPathDescriptor {
  return { path, valueType, accessDomain, pathScope, blockingIssueCode };
}

const DESCRIPTORS: readonly RuleFactPathDescriptor[] = [
  descriptor("case.desiredProcedure", "STRING", "CASE_LEGAL", "CASE", null),
  descriptor("case.adultStatus", "STRING", "CASE_LEGAL", "CASE", "ADULT_STATUS_REQUIRED"),
  descriptor("case.location.kind", "STRING", "CASE_LEGAL", "CASE", "APPLICANT_LOCATION_REQUIRED"),
  descriptor(
    "case.location.countryCode",
    "STRING",
    "CASE_LEGAL",
    "CASE",
    "APPLICANT_LOCATION_REQUIRED",
  ),
  descriptor("case.maritalStatus", "STRING", "CASE_LEGAL", "CASE", "MARITAL_STATUS_REQUIRED"),
  descriptor(
    "case.holdsPreviousParaguayanCedula",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "PREVIOUS_CEDULA_ANSWER_REQUIRED",
  ),
  descriptor(
    "case.residence.reportedType",
    "STRING",
    "CASE_LEGAL",
    "CASE",
    "RESIDENCE_STATUS_REQUIRED",
  ),
  descriptor(
    "case.residence.card.state",
    "STRING",
    "CASE_LEGAL",
    "CASE",
    "RESIDENCE_CARD_STATE_REQUIRED",
  ),
  descriptor(
    "case.residence.card.expiryDate",
    "LOCAL_DATE",
    "CASE_LEGAL",
    "CASE",
    "RESIDENCE_CARD_EXPIRY_REQUIRED",
  ),
  descriptor(
    "case.entryTravelDocumentCountry",
    "STRING",
    "CASE_LEGAL",
    "CASE",
    "ENTRY_TRAVEL_DOCUMENT_REQUIRED",
  ),
  descriptor(
    "case.processTravelDocumentCountry",
    "STRING",
    "CASE_LEGAL",
    "CASE",
    "PROCESS_TRAVEL_DOCUMENT_REQUIRED",
  ),
  descriptor("case.citizenshipCountries", "STRING_SET", "CASE_LEGAL", "CASE", "NATIONALITY_REQUIRED"),
  descriptor("case.citizenshipCount", "INTEGER", "CASE_LEGAL", "CASE", "NATIONALITY_REQUIRED"),
  descriptor(
    "case.specialCase.paraguayanCitizenship",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.specialCase.paraguayanParent",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.specialCase.paraguayanSpouse",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.specialCase.repatriadoFamily",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.specialCase.diplomaticStatus",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.specialCase.protectionStatus",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.specialCase.investorStatus",
    "BOOLEAN",
    "CASE_LEGAL",
    "CASE",
    "SPECIAL_CASE_ANSWERS_REQUIRED",
  ),
  descriptor(
    "case.entryEvidence.state",
    "STRING",
    "ENTRY_READINESS",
    "CASE",
    "ENTRY_EVIDENCE_REQUIRED",
  ),
  descriptor("context.effectiveLocalDate", "LOCAL_DATE", "CASE_LEGAL", "CONTEXT", null),
  descriptor(
    "scope.nationality.countryCode",
    "STRING",
    "CASE_LEGAL",
    "NATIONALITY",
    "NATIONALITY_REQUIRED",
  ),
  descriptor("scope.nationality.roles", "STRING_SET", "CASE_LEGAL", "NATIONALITY", "NATIONALITY_REQUIRED"),
  descriptor(
    "scope.residenceHistory.countryCode",
    "STRING",
    "CASE_LEGAL",
    "RESIDENCE_HISTORY",
    "RESIDENCE_HISTORY_REQUIRED",
  ),
  descriptor(
    "scope.residenceHistory.from",
    "LOCAL_DATE",
    "CASE_LEGAL",
    "RESIDENCE_HISTORY",
    "RESIDENCE_HISTORY_REQUIRED",
  ),
  descriptor(
    "scope.residenceHistory.to",
    "LOCAL_DATE",
    "CASE_LEGAL",
    "RESIDENCE_HISTORY",
    "RESIDENCE_HISTORY_REQUIRED",
  ),
  descriptor(
    "scope.document.documentTypeId",
    "STRING",
    "DOCUMENT_STATE",
    "DOCUMENT",
    "DOCUMENT_DETAILS_REQUIRED",
  ),
  descriptor(
    "scope.document.issuingCountry",
    "STRING",
    "DOCUMENT_STATE",
    "DOCUMENT",
    "DOCUMENT_DETAILS_REQUIRED",
  ),
  descriptor(
    "scope.document.issueDate",
    "LOCAL_DATE",
    "DOCUMENT_STATE",
    "DOCUMENT",
    "DOCUMENT_DETAILS_REQUIRED",
  ),
  descriptor(
    "scope.document.expiryDate",
    "LOCAL_DATE",
    "DOCUMENT_STATE",
    "DOCUMENT",
    "DOCUMENT_DETAILS_REQUIRED",
  ),
  descriptor(
    "scope.document.language",
    "STRING",
    "DOCUMENT_STATE",
    "DOCUMENT",
    "DOCUMENT_DETAILS_REQUIRED",
  ),
  descriptor(
    "scope.document.readinessStatus",
    "STRING",
    "DOCUMENT_STATE",
    "DOCUMENT",
    "DOCUMENT_DETAILS_REQUIRED",
  ),
];

const REGISTRY: ReadonlyMap<string, RuleFactPathDescriptor> = new Map(
  DESCRIPTORS.map((entry) => [entry.path as string, entry]),
);

export const ALL_RULE_FACT_PATHS: readonly RuleFactPath[] = DESCRIPTORS.map((entry) => entry.path);

export function lookupFactPath(path: string): RuleFactPathDescriptor | null {
  return REGISTRY.get(path) ?? null;
}

export function isRegisteredFactPath(path: string): path is RuleFactPath {
  return REGISTRY.has(path);
}

/**
 * Closed fact-dependency policy registry (Decision 082): the only sanctioned
 * translation from "this fact was indeterminate" to a public blocking issue.
 */
export function blockingIssueCodeForPath(path: RuleFactPath): BlockingIssueCode | null {
  const found = REGISTRY.get(path as string);
  return found === undefined ? null : found.blockingIssueCode;
}

/** The rule scope a path can be read in, besides CASE / CONTEXT paths. */
export function requiredRuleScopeForPath(path: RuleFactPath): FactPathScope {
  const found = REGISTRY.get(path as string);
  /* v8 ignore next 3 -- unreachable for RuleFactPath-typed input; the throw guards a caller that bypasses the type. */
  if (found === undefined) {
    throw new Error(`unregistered fact path: ${path}`);
  }
  return found.pathScope;
}
