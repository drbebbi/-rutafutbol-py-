import { err, ok, type Result } from "../../shared/result/result";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { Sha256Hex } from "../../domain/primitives/hash";
import type { RuleId } from "../../domain/identifiers/identifiers";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { CaseEvaluationDecision } from "../../domain/evaluation/decision";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../domain/evaluation/engine-descriptor";
import { JURISDICTION_TIME_ZONE } from "../../domain/primitives/time-zone";
import type { InstantString } from "../../domain/primitives/instant";
import { createEvaluationExecutionContext } from "../../case-engine/date-math/execution-context";
import { evaluateCase } from "../../case-engine/evaluate/evaluate-case";
import { canonicalJsonStringify } from "../../shared/serialization/canonical-json";
import {
  prepareEngineReadyBundle,
  type BundleValidationIssue,
} from "../../rules/bundle/engine-ready-bundle";
import { evaluationBundleContentHash } from "../../rules/bundle/canonical-bundle";
import type { EvaluationBundleContent } from "../../rules/bundle/bundle-content";
import { rulePayloadSchema, ruleRevisionSchema } from "../../rules/validation/schemas";

/**
 * Publication validation.
 *
 * A production publication never starts a test runner. This service performs
 * the same checks the engine relies on - schema, fact access, evidence,
 * precedence, cycles, bundle semantics, conflicts - and then measures the
 * candidate's impact by re-evaluating a safety corpus of cases.
 */
export type SafetyCorpusCase = Readonly<{
  caseId: string;
  facts: UserCaseFacts;
  evaluatedAt: InstantString;
}>;

export type ImpactKind = "UNCHANGED" | "CHANGED" | "NEWLY_FAILING" | "NEWLY_PASSING";

export type CaseImpact = Readonly<{
  caseId: string;
  impact: ImpactKind;
  beforeStatus: string | null;
  afterStatus: string | null;
}>;

export type PublicationImpactReport = Readonly<{
  candidateBundleHash: Sha256Hex;
  ruleIds: readonly RuleId[];
  totalCases: number;
  unchanged: number;
  changed: number;
  newlyFailing: number;
  newlyPassing: number;
  perCase: readonly CaseImpact[];
}>;

export type PublicationValidationFailure =
  | Readonly<{ kind: "SCHEMA"; detail: string }>
  | Readonly<{ kind: "BUNDLE"; issues: readonly BundleValidationIssue[] }>;

function statusOf(decision: Result<CaseEvaluationDecision, unknown>): string | null {
  return decision.ok ? decision.value.caseClassification.status : null;
}

/**
 * Validates a candidate bundle and reports its impact.
 *
 * The returned `candidateBundleHash` is what an approval is bound to: a
 * publication that cannot show the same hash again is refused as stale.
 */
export function validatePublicationCandidate(
  candidate: EvaluationBundleContent,
  baseline: EvaluationBundleContent,
  corpus: readonly SafetyCorpusCase[],
  effectiveLocalDate: LocalDate,
): Result<PublicationImpactReport, PublicationValidationFailure> {
  // 1. Wire-shape validation of every candidate rule and payload.
  for (const revision of candidate.ruleRevisions) {
    const parsedRevision = ruleRevisionSchema.safeParse(revision);
    if (!parsedRevision.success) {
      return err({
        kind: "SCHEMA",
        detail: `rule ${String(revision.ruleId)}: ${JSON.stringify(parsedRevision.error.issues)}`,
      });
    }
    const parsedPayload = rulePayloadSchema.safeParse(revision.payload);
    if (!parsedPayload.success) {
      return err({
        kind: "SCHEMA",
        detail: `payload of ${String(revision.ruleId)}: ${JSON.stringify(parsedPayload.error.issues)}`,
      });
    }
  }

  // 2..8. Fact-path access, evidence, precedence, cycles, semantics and
  // conflicts are all enforced while turning the bundle engine-ready.
  const candidateBundle = prepareEngineReadyBundle(candidate, effectiveLocalDate);
  if (!candidateBundle.ok) {
    return err({ kind: "BUNDLE", issues: candidateBundle.error });
  }
  const baselineBundle = prepareEngineReadyBundle(baseline, effectiveLocalDate);

  // 9. Safety corpus impact.
  const perCase: CaseImpact[] = [];
  let unchanged = 0;
  let changed = 0;
  let newlyFailing = 0;
  let newlyPassing = 0;

  for (const entry of corpus) {
    const context = createEvaluationExecutionContext({
      evaluatedAt: entry.evaluatedAt,
      jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
    });
    if (!context.ok) {
      continue;
    }
    const after = evaluateCase(entry.facts, context.value, candidateBundle.value, CURRENT_ENGINE_DESCRIPTOR);
    const before = baselineBundle.ok
      ? evaluateCase(entry.facts, context.value, baselineBundle.value, CURRENT_ENGINE_DESCRIPTOR)
      : null;

    const beforeStatus = before === null ? null : statusOf(before);
    const afterStatus = statusOf(after);

    let impact: ImpactKind;
    if (before !== null && before.ok && !after.ok) {
      impact = "NEWLY_FAILING";
      newlyFailing += 1;
    } else if (before !== null && !before.ok && after.ok) {
      impact = "NEWLY_PASSING";
      newlyPassing += 1;
    } else if (
      before !== null &&
      before.ok &&
      after.ok &&
      canonicalJsonStringify(before.value) !== canonicalJsonStringify(after.value)
    ) {
      impact = "CHANGED";
      changed += 1;
    } else {
      impact = "UNCHANGED";
      unchanged += 1;
    }

    perCase.push({ caseId: entry.caseId, impact, beforeStatus, afterStatus });
  }

  return ok({
    candidateBundleHash: evaluationBundleContentHash(candidate),
    ruleIds: candidate.ruleRevisions.map((revision) => revision.ruleId),
    totalCases: corpus.length,
    unchanged,
    changed,
    newlyFailing,
    newlyPassing,
    perCase: [...perCase].sort((a, b) => (a.caseId < b.caseId ? -1 : 1)),
  });
}

export type PublicationApproval = Readonly<{
  approvedCandidateBundleHash: Sha256Hex;
  approvedBy: string;
  approvedAt: InstantString;
}>;

export type StalePublication = Readonly<{
  kind: "STALE_PUBLICATION_VALIDATION";
  approved: Sha256Hex;
  actual: Sha256Hex;
}>;

/**
 * Binds an approval to the exact bytes that were validated.
 *
 * If the candidate moved at all after approval, publishing it would ship
 * something nobody validated, so the publication is refused rather than
 * re-validated implicitly.
 */
export function assertApprovalStillValid(
  approval: PublicationApproval,
  currentCandidate: EvaluationBundleContent,
): Result<Sha256Hex, StalePublication> {
  const actual = evaluationBundleContentHash(currentCandidate);
  if ((actual as string) !== (approval.approvedCandidateBundleHash as string)) {
    return err({
      kind: "STALE_PUBLICATION_VALIDATION",
      approved: approval.approvedCandidateBundleHash,
      actual,
    });
  }
  return ok(actual);
}
