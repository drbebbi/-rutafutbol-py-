import type {
  DocumentTypeId,
  FormalityCode,
  RequiredDocumentKey,
  RequiredProcedureKey,
} from "../identifiers/identifiers";
import type { CountryCode } from "../primitives/country";
import type { SupportLevel } from "../rules/verification";
import type { ProvenanceRef } from "../evaluation/provenance";

export type RequiredDocumentIdentity = Readonly<{
  forProcedure: RequiredProcedureKey;
  documentTypeId: DocumentTypeId;
  issuingCountry: CountryCode | null;
  discriminator: string | null;
}>;

/** A formality (legalisation, apostille, sworn translation, ...) on a document. */
export type RequiredFormality = Readonly<{
  formalityCode: FormalityCode;
  support: SupportLevel;
  provenance: readonly ProvenanceRef[];
}>;

export type RequiredDocument = Readonly<{
  key: RequiredDocumentKey;
  identity: RequiredDocumentIdentity;
  formalities: readonly RequiredFormality[];
  support: SupportLevel;
  provenance: readonly ProvenanceRef[];
}>;

/**
 * Whether an existing document can be reused for a further procedure.
 *
 * REUSE_UNKNOWN is a first-class outcome: the absence of a rule must never be
 * read as "reusable", nor as "not allowed", nor as "must be reissued".
 */
export type DocumentReuseResolution =
  | "REUSABLE_CONFIRMED"
  | "REUSE_NOT_ALLOWED"
  | "REISSUE_REQUIRED"
  | "REUSE_UNKNOWN";

export const DOCUMENT_REUSE_RESOLUTIONS: readonly DocumentReuseResolution[] = [
  "REUSABLE_CONFIRMED",
  "REUSE_NOT_ALLOWED",
  "REISSUE_REQUIRED",
  "REUSE_UNKNOWN",
];

export type DocumentReuseAssessment = Readonly<{
  documentKey: RequiredDocumentKey;
  resolution: DocumentReuseResolution;
  support: SupportLevel | null;
  provenance: readonly ProvenanceRef[];
}>;
