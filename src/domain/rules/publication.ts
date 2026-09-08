/** Lifecycle of a rule (or knowledge) revision. */
export type PublicationStatus =
  | "DRAFT"
  | "REVIEWED"
  | "APPROVED"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "RETIRED";

export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  "DRAFT",
  "REVIEWED",
  "APPROVED",
  "PUBLISHED",
  "SUPERSEDED",
  "RETIRED",
];

/**
 * Statuses eligible for a *new* evaluation bundle, subject to the effective
 * window.
 *
 * SUPERSEDED is eligible because an evaluation dated inside a superseded
 * revision's window must still see the law as it stood then. DRAFT, REVIEWED
 * and APPROVED are not published knowledge, and RETIRED has been withdrawn.
 */
export const BUNDLE_ELIGIBLE_PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  "PUBLISHED",
  "SUPERSEDED",
];

export function isBundleEligible(status: PublicationStatus): boolean {
  return status === "PUBLISHED" || status === "SUPERSEDED";
}
