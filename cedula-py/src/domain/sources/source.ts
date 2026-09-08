import type { AuthorityId, SourceId, SourceRevisionId } from "../identifiers/identifiers";
import type { InstantString } from "../primitives/instant";
import type { LanguageCode } from "../primitives/language";
import type { PublicationStatus } from "../rules/publication";

export type SourceKind =
  | "LAW"
  | "DECREE"
  | "RESOLUTION"
  | "OFFICIAL_WEBSITE"
  | "OFFICIAL_FORM"
  | "OFFICIAL_FEE_SCHEDULE";

export const SOURCE_KINDS: readonly SourceKind[] = [
  "LAW",
  "DECREE",
  "RESOLUTION",
  "OFFICIAL_WEBSITE",
  "OFFICIAL_FORM",
  "OFFICIAL_FEE_SCHEDULE",
];

export type Source = Readonly<{
  sourceId: SourceId;
  authorityId: AuthorityId;
  kind: SourceKind;
  /** Stable citation label, e.g. "Ley 6984/2022". */
  citation: string;
}>;

export type SourceRevision = Readonly<{
  sourceRevisionId: SourceRevisionId;
  sourceId: SourceId;
  publicationStatus: PublicationStatus;
  language: LanguageCode;
  /** When this exact wording was retrieved / verified. */
  retrievedAt: InstantString;
  /** Canonical locator, e.g. an official URL or a document reference. */
  locator: string;
}>;

/** A rule revision's link to the evidence that supports it. */
export type RuleEvidence = Readonly<{
  sourceRevisionId: SourceRevisionId;
  /** Free-text pointer into the source (article, section, table row). */
  citationDetail: string;
}>;
