import type { DocumentInstanceId, DocumentTypeId } from "../identifiers/identifiers";
import type { OptionalFact } from "../case/knowledge";
import type { CountryCode } from "../primitives/country";
import type { LanguageCode } from "../primitives/language";
import type { LocalDate } from "../primitives/local-date";

/**
 * Readiness of a document the applicant already has (or is working on).
 *
 * This lives in the *readiness* half of `UserCaseFacts` and is only visible to
 * rules in the DOCUMENT_STATE fact-access domain. A legal requirement rule can
 * never read it, so "I already have my birth certificate" can never delete the
 * legal requirement for a birth certificate.
 */
export type DocumentReadinessStatus = "NOT_STARTED" | "IN_PROGRESS" | "OBTAINED" | "EXPIRED";

export const DOCUMENT_READINESS_STATUSES: readonly DocumentReadinessStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "OBTAINED",
  "EXPIRED",
];

export type DocumentInstanceFacts = Readonly<{
  instanceId: DocumentInstanceId;
  documentTypeId: DocumentTypeId;
  issuingCountry: OptionalFact<CountryCode>;
  issueDate: OptionalFact<LocalDate>;
  expiryDate: OptionalFact<LocalDate>;
  language: OptionalFact<LanguageCode>;
  readinessStatus: DocumentReadinessStatus;
}>;
