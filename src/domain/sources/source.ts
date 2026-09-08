import type { AuthorityId, SourceId, SourceRevisionId } from "../identifiers/identifiers";
import type { InstantString } from "../primitives/instant";
import type { LocalDate } from "../primitives/local-date";
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

/**
 * How confident the research process is in a captured source revision.
 *
 * About the *capture*, not about the law: a perfectly clear statute read from
 * a mirror of unclear provenance is LOW, and a scan of an official gazette is
 * HIGH even when the text it contains is ambiguous.
 */
export type SourceConfidence = "HIGH" | "MEDIUM" | "LOW";

export const SOURCE_CONFIDENCES: readonly SourceConfidence[] = ["HIGH", "MEDIUM", "LOW"];

export type SourceRevision = Readonly<{
  sourceRevisionId: SourceRevisionId;
  sourceId: SourceId;
  publicationStatus: PublicationStatus;
  language: LanguageCode;
  /**
   * When the issuing authority published this wording.
   *
   * Optional, and deliberately so: plenty of official web pages carry no
   * publication date at all. Recording an inferred one would turn a gap in the
   * source into a fact the engine could later reason about.
   */
  publishedAt: LocalDate | null;
  /** When this exact wording was retrieved / verified. */
  retrievedAt: InstantString;
  /**
   * The window during which this wording is the law.
   *
   * Distinct from the retrieval time above: when a source was fetched says
   * nothing about when what it says applies.
   */
  effectiveFrom: LocalDate | null;
  effectiveUntil: LocalDate | null;
  /** The revision this one replaces, when the authority reissued the source. */
  supersedes: SourceRevisionId | null;
  confidence: SourceConfidence;
  /** Free-text research notes; never read by the engine. */
  notes: string | null;
  /** Canonical locator, e.g. an official URL or a document reference. */
  locator: string;
}>;

/**
 * What a piece of evidence does for the rule that cites it.
 *
 * SUPPORTS and CONTRADICTS are both recorded. A rule whose evidence set
 * contains a contradiction is exactly the situation that makes it CONFLICTING,
 * and dropping the contradicting source would erase the reason.
 */
export type EvidenceRole = "SUPPORTS" | "CONTRADICTS" | "CONTEXT";

export const EVIDENCE_ROLES: readonly EvidenceRole[] = ["SUPPORTS", "CONTRADICTS", "CONTEXT"];

/** A rule revision's link to the evidence that supports it. */
export type RuleEvidence = Readonly<{
  sourceRevisionId: SourceRevisionId;
  role: EvidenceRole;
  /** What this source is being cited as saying, in the researcher's words. */
  claimSummary: string;
  /** Free-text pointer into the source (article, section, table row). */
  citationDetail: string;
  /** A short verbatim quote, so a reviewer can check the reading. */
  quote: string | null;
}>;
