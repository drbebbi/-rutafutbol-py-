import type {
  FeeComponentCode,
  RequiredDocumentKey,
  RequiredProcedureKey,
  VisaPurposeCode,
} from "../identifiers/identifiers";
import type { UnresolvedReason } from "../rules/verification";
import type { ProvenanceRef } from "./provenance";

/**
 * Closed set of blocking issues.
 *
 * There is deliberately no generic `MISSING_FIELD(path)` output. A public
 * "missing field: case.residence.card.expiryDate" would leak the internal fact
 * model into the product surface and would age badly; instead every fact path
 * maps, through a closed registry, onto a business-meaningful code.
 */
export type BlockingIssueCode =
  | "ADULT_STATUS_REQUIRED"
  | "APPLICANT_LOCATION_REQUIRED"
  | "MARITAL_STATUS_REQUIRED"
  | "NATIONALITY_REQUIRED"
  | "PREVIOUS_CEDULA_ANSWER_REQUIRED"
  | "RESIDENCE_STATUS_REQUIRED"
  | "RESIDENCE_CARD_STATE_REQUIRED"
  | "RESIDENCE_CARD_EXPIRY_REQUIRED"
  | "RESIDENCE_HISTORY_REQUIRED"
  | "ENTRY_TRAVEL_DOCUMENT_REQUIRED"
  | "PROCESS_TRAVEL_DOCUMENT_REQUIRED"
  | "SPECIAL_CASE_ANSWERS_REQUIRED"
  | "DOCUMENT_DETAILS_REQUIRED"
  | "ENTRY_EVIDENCE_REQUIRED";

export const BLOCKING_ISSUE_CODES: readonly BlockingIssueCode[] = [
  "ADULT_STATUS_REQUIRED",
  "APPLICANT_LOCATION_REQUIRED",
  "MARITAL_STATUS_REQUIRED",
  "NATIONALITY_REQUIRED",
  "PREVIOUS_CEDULA_ANSWER_REQUIRED",
  "RESIDENCE_STATUS_REQUIRED",
  "RESIDENCE_CARD_STATE_REQUIRED",
  "RESIDENCE_CARD_EXPIRY_REQUIRED",
  "RESIDENCE_HISTORY_REQUIRED",
  "ENTRY_TRAVEL_DOCUMENT_REQUIRED",
  "PROCESS_TRAVEL_DOCUMENT_REQUIRED",
  "SPECIAL_CASE_ANSWERS_REQUIRED",
  "DOCUMENT_DETAILS_REQUIRED",
  "ENTRY_EVIDENCE_REQUIRED",
];

export type BlockingIssue = Readonly<{
  code: BlockingIssueCode;
  /** Which product decision the missing answer is actually blocking. */
  blockedSlotFamily: string;
}>;

/** What a verification request is *about*. */
export type VerificationTargetKind =
  | "CASE"
  | "PROCEDURE"
  | "DOCUMENT"
  | "VISA_PURPOSE"
  | "FEE_COMPONENT";

export type VerificationTarget =
  | Readonly<{ kind: "CASE" }>
  | Readonly<{ kind: "PROCEDURE"; procedureKey: RequiredProcedureKey }>
  | Readonly<{ kind: "DOCUMENT"; documentKey: RequiredDocumentKey }>
  | Readonly<{ kind: "VISA_PURPOSE"; purposeCode: VisaPurposeCode }>
  | Readonly<{
      kind: "FEE_COMPONENT";
      procedureKey: RequiredProcedureKey;
      componentCode: FeeComponentCode;
    }>;

/**
 * Closed set of verification codes.
 *
 * `TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET` is the code for the known open
 * research conflict: the Identificaciones publication is titled for temporal
 * and permanent residents but lists permanent-residence documents, so the
 * temporal document set under Resolucion 717/26 is CONFLICTING and needs
 * official verification. The engine emits this flag instead of substituting a
 * temporal document list of its own invention.
 */
export type VerificationCode =
  | "CASE_CLASSIFICATION_UNCONFIRMED"
  | "RESIDENCE_CLASSIFICATION_UNCONFIRMED"
  | "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET"
  | "VISA_REQUIREMENT_UNCONFIRMED"
  | "PROCEDURE_REQUIREMENT_UNCONFIRMED"
  | "DOCUMENT_REQUIREMENT_UNCONFIRMED"
  | "DOCUMENT_FORMALITY_UNCONFIRMED"
  | "DOCUMENT_REUSE_UNCONFIRMED"
  | "PROCEDURE_DEPENDENCY_UNCONFIRMED"
  | "FEE_AMOUNT_UNCONFIRMED"
  | "PRODUCT_COVERAGE_RESEARCH_REQUIRED";

export const VERIFICATION_CODES: readonly VerificationCode[] = [
  "CASE_CLASSIFICATION_UNCONFIRMED",
  "RESIDENCE_CLASSIFICATION_UNCONFIRMED",
  "TEMPORAL_IDENTIFICACIONES_DOCUMENT_SET",
  "VISA_REQUIREMENT_UNCONFIRMED",
  "PROCEDURE_REQUIREMENT_UNCONFIRMED",
  "DOCUMENT_REQUIREMENT_UNCONFIRMED",
  "DOCUMENT_FORMALITY_UNCONFIRMED",
  "DOCUMENT_REUSE_UNCONFIRMED",
  "PROCEDURE_DEPENDENCY_UNCONFIRMED",
  "FEE_AMOUNT_UNCONFIRMED",
  "PRODUCT_COVERAGE_RESEARCH_REQUIRED",
];

export type VerificationFlag = Readonly<{
  code: VerificationCode;
  target: VerificationTarget;
  reason: UnresolvedReason;
  provenance: readonly ProvenanceRef[];
}>;

/** Structural and legal modifiers surfaced with the decision. */
export type CaseModifierCode =
  | "MINOR_APPLICANT"
  | "MULTIPLE_CITIZENSHIPS"
  | "PARAGUAYAN_CITIZENSHIP_DECLARED"
  | "APPLICANT_ABROAD"
  | "APPLICANT_IN_PARAGUAY"
  | "RESIDENCE_CARD_EXPIRED"
  | "PROCESS_DOCUMENT_DIFFERS_FROM_ENTRY_DOCUMENT"
  | "VISA_REQUIRED"
  | "VISA_NOT_REQUIRED";

export const CASE_MODIFIER_CODES: readonly CaseModifierCode[] = [
  "MINOR_APPLICANT",
  "MULTIPLE_CITIZENSHIPS",
  "PARAGUAYAN_CITIZENSHIP_DECLARED",
  "APPLICANT_ABROAD",
  "APPLICANT_IN_PARAGUAY",
  "RESIDENCE_CARD_EXPIRED",
  "PROCESS_DOCUMENT_DIFFERS_FROM_ENTRY_DOCUMENT",
  "VISA_REQUIRED",
  "VISA_NOT_REQUIRED",
];

export type CaseModifier = Readonly<{
  code: CaseModifierCode;
  /** Optional qualifier, e.g. the visa purpose a VISA_* modifier refers to. */
  qualifier: string | null;
  provenance: readonly ProvenanceRef[];
}>;

export type WarningCode =
  | "STRONG_EVIDENCE_ONLY"
  | "PROCESSING_TIME_INDICATION"
  | "FEE_MAY_CHANGE"
  | "DOCUMENT_VALIDITY_WINDOW"
  | "PRODUCT_SCOPE_PARTIAL";

export const WARNING_CODES: readonly WarningCode[] = [
  "STRONG_EVIDENCE_ONLY",
  "PROCESSING_TIME_INDICATION",
  "FEE_MAY_CHANGE",
  "DOCUMENT_VALIDITY_WINDOW",
  "PRODUCT_SCOPE_PARTIAL",
];

export type WarningSeverity = "INFO" | "CAUTION";

export type Warning = Readonly<{
  code: WarningCode;
  severity: WarningSeverity;
  qualifier: string | null;
  provenance: readonly ProvenanceRef[];
}>;
