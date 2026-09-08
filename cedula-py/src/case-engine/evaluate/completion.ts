import type { BlockingIssue, VerificationFlag } from "../../domain/evaluation/issues";
import type { ClassificationStatus } from "../../domain/case/classification";

/**
 * Internal completion assessment, computed before a final status is chosen.
 *
 * Precedence is fixed and deliberate: an unsupported case is unsupported no
 * matter what else is open; a missing user answer outranks an open official
 * question, because answering it may remove the official question entirely.
 */
export type CompletionAssessment =
  | "UNSUPPORTED"
  | "NEEDS_USER_INFORMATION"
  | "NEEDS_OFFICIAL_VERIFICATION"
  | "OTHERWISE_COMPLETE";

export function assessCompletion(
  unsupported: boolean,
  blockingIssues: readonly BlockingIssue[],
  verificationFlags: readonly VerificationFlag[],
): CompletionAssessment {
  if (unsupported) {
    return "UNSUPPORTED";
  }
  if (blockingIssues.length > 0) {
    return "NEEDS_USER_INFORMATION";
  }
  if (verificationFlags.length > 0) {
    return "NEEDS_OFFICIAL_VERIFICATION";
  }
  return "OTHERWISE_COMPLETE";
}

/**
 * Turns the assessment into the public classification status.
 *
 * A result that rests on STRONG_EVIDENCE rather than a confirmed source is
 * still usable, but it is never reported as plain COMPLETE - the user is told,
 * through COMPLETE_WITH_WARNINGS, that part of this rests on strong but
 * unconfirmed evidence.
 */
export function finalStatus(
  assessment: CompletionAssessment,
  hasWarnings: boolean,
  restsOnStrongEvidenceOnly: boolean,
): ClassificationStatus {
  switch (assessment) {
    case "UNSUPPORTED":
      return "UNSUPPORTED";
    case "NEEDS_USER_INFORMATION":
      return "NEEDS_USER_INFORMATION";
    case "NEEDS_OFFICIAL_VERIFICATION":
      return "NEEDS_OFFICIAL_VERIFICATION";
    case "OTHERWISE_COMPLETE":
      return hasWarnings || restsOnStrongEvidenceOnly ? "COMPLETE_WITH_WARNINGS" : "COMPLETE";
  }
}
