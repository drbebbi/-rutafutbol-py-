/**
 * Verification status of a rule revision (final list).
 *
 * Note what is *not* here: OUTDATED. Whether a revision still applies is
 * decided by its effective window and publication status, not by mixing a
 * lifecycle concept into the evidence quality scale.
 */
export type VerificationStatus =
  | "CONFIRMED"
  | "STRONG_EVIDENCE"
  | "CONFLICTING"
  | "UNKNOWN"
  | "OFFICIAL_VERIFICATION_REQUIRED";

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  "CONFIRMED",
  "STRONG_EVIDENCE",
  "CONFLICTING",
  "UNKNOWN",
  "OFFICIAL_VERIFICATION_REQUIRED",
];

/** The subset of verification statuses that can carry a resolved consequence. */
export type SupportLevel = "CONFIRMED" | "STRONG_EVIDENCE";

export const SUPPORT_LEVELS: readonly SupportLevel[] = ["CONFIRMED", "STRONG_EVIDENCE"];

export function isSupportLevel(status: VerificationStatus): status is SupportLevel {
  return status === "CONFIRMED" || status === "STRONG_EVIDENCE";
}

/** Why a rule could not produce an authoritative consequence. */
export type UnresolvedReason = "CONFLICTING" | "UNKNOWN" | "OFFICIAL_VERIFICATION_REQUIRED";

export function unresolvedReasonFor(status: VerificationStatus): UnresolvedReason | null {
  switch (status) {
    case "CONFIRMED":
    case "STRONG_EVIDENCE":
      return null;
    case "CONFLICTING":
    case "UNKNOWN":
    case "OFFICIAL_VERIFICATION_REQUIRED":
      return status;
  }
}

/**
 * Merging support for one and the same consequence.
 *
 * CONFIRMED wins: if at least one confirmed rule states the consequence, the
 * merged statement is confirmed, and the strong-evidence rule's provenance is
 * retained. Nothing here can promote STRONG_EVIDENCE on its own.
 */
export function mergeSupport(left: SupportLevel, right: SupportLevel): SupportLevel {
  return left === "CONFIRMED" || right === "CONFIRMED" ? "CONFIRMED" : "STRONG_EVIDENCE";
}
