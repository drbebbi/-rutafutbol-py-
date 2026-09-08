/**
 * The editorial model behind a rule.
 *
 * A claim becomes publishable knowledge only by passing through review. This
 * mirrors the `research` schema and exists so the admin application can reason
 * about the pipeline without importing database types.
 */
export type ClaimReviewOutcome = "ACCEPTED" | "REJECTED" | "NEEDS_MORE_EVIDENCE";

export type ResearchConflictStatus = "OPEN" | "RESOLVED" | "OFFICIAL_VERIFICATION_REQUESTED";

export type ReviewGate = Readonly<{
  claimKey: string;
  outcome: ClaimReviewOutcome;
  reviewerCount: number;
}>;

/**
 * A claim may back a published rule only when it was accepted and no conflict
 * touching it is still open. "Strong evidence" is publishable; "contradicted by
 * another source" is not, until the contradiction is recorded and the rule is
 * marked CONFLICTING rather than resolved.
 */
export function claimIsPublishable(
  gate: ReviewGate,
  openConflicts: readonly string[],
): boolean {
  return gate.outcome === "ACCEPTED" && !openConflicts.includes(gate.claimKey);
}
