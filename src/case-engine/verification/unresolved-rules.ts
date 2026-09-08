import { ok, type Result } from "../../shared/result/result";
import type { RuleId } from "../../domain/identifiers/identifiers";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { VerificationCode, VerificationFlag } from "../../domain/evaluation/issues";
import type { UnresolvedReason } from "../../domain/rules/verification";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import {
  decisionSlotFamilyForPayload,
  type DecisionSlotFamily,
  type VerificationTargetTemplate,
} from "../../rules/definitions/payloads";
import type { ScopeBinding } from "../classify/fact-view";
import { compareStrings } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import type { RuleInstance } from "../evaluate/rule-instances";
import type { BlockingFactPath } from "./blocking-issues";
import {
  resolveVerificationTarget,
  type VerificationResolutionContext,
} from "./target-resolution";

/**
 * A verification request a rule made, before its target has been resolved.
 *
 * Unresolved rules never enter a decision slot, so they travel on their own
 * track through the whole evaluation and are only turned into flags once the
 * procedures, documents and fees they point at exist.
 */
export type PendingVerification = Readonly<{
  ruleId: RuleId;
  slotFamily: DecisionSlotFamily;
  truth: "TRUE" | "INDETERMINATE";
  code: VerificationCode;
  reason: UnresolvedReason;
  target: VerificationTargetTemplate;
  binding: ScopeBinding | null;
  indeterminateFactPaths: readonly RuleFactPath[];
  unguardedNotApplicablePaths: readonly RuleFactPath[];
  provenance: ProvenanceRef;
}>;

/** Every rule instance that states a verification request rather than a consequence. */
export function collectPendingVerifications(
  instancesByFamily: ReadonlyMap<string, readonly RuleInstance[]>,
): readonly PendingVerification[] {
  const pending: PendingVerification[] = [];
  for (const instances of instancesByFamily.values()) {
    for (const instance of instances) {
      if (instance.unresolved === null || instance.truth === "FALSE") {
        continue;
      }
      pending.push({
        ruleId: instance.revision.ruleId,
        slotFamily: decisionSlotFamilyForPayload(instance.revision.payload),
        truth: instance.truth,
        code: instance.unresolved.verification.code,
        reason: instance.unresolved.reason,
        target: instance.unresolved.verification.target,
        binding: instance.binding,
        indeterminateFactPaths: instance.indeterminateFactPaths,
        unguardedNotApplicablePaths: instance.unguardedNotApplicablePaths,
        provenance: instance.provenance,
      });
    }
  }
  return [...pending].sort((a, b) => compareStrings(a.ruleId as string, b.ruleId as string));
}

export type UnresolvedRuleOutcome = Readonly<{
  flags: readonly VerificationFlag[];
  blockingPaths: readonly BlockingFactPath[];
  /** Slot families in which a verification request survived and was raised. */
  familiesWithFlags: ReadonlySet<DecisionSlotFamily>;
}>;

/**
 * Turns verification requests into flags, and unanswered ones into blockers.
 *
 * Three things happen here, in this order:
 *
 *  1. a request from a rule a confirmed winner explicitly takes precedence
 *     over is dropped - that rule could not have changed the answer, so it
 *     cannot ask a question about it either;
 *  2. a request from a rule that is TRUE has its target resolved against the
 *     decision, and becomes a flag (or is dropped when the target was decided
 *     not to apply);
 *  3. a request from a rule that is still INDETERMINATE becomes a blocking
 *     fact path - unless the same slot family already has a flag, in which
 *     case answering the question could not change what the user is told.
 */
export function resolveUnresolvedRules(
  pending: readonly PendingVerification[],
  suppressedRuleIds: ReadonlySet<string>,
  context: VerificationResolutionContext,
): Result<UnresolvedRuleOutcome, EngineError> {
  const surviving = pending.filter((entry) => !suppressedRuleIds.has(entry.ruleId as string));

  const flags: VerificationFlag[] = [];
  const familiesWithFlags = new Set<DecisionSlotFamily>();
  for (const entry of surviving) {
    if (entry.truth !== "TRUE") {
      continue;
    }
    const resolved = resolveVerificationTarget(entry.target, entry.binding, context, entry.ruleId);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.value.state === "NOT_APPLICABLE") {
      continue;
    }
    familiesWithFlags.add(entry.slotFamily);
    flags.push({
      code: entry.code,
      target: resolved.value.target,
      reason: entry.reason,
      provenance: [entry.provenance],
    });
  }

  const blockingPaths: BlockingFactPath[] = [];
  for (const entry of surviving) {
    if (entry.truth !== "INDETERMINATE" || familiesWithFlags.has(entry.slotFamily)) {
      continue;
    }
    if (entry.unguardedNotApplicablePaths.length > 0) {
      // A NOT_APPLICABLE fact compared as a value leaves the rule stuck. That
      // is a modelling defect in the rule, not a question for the user.
      return {
        ok: false,
        error: ruleConfigurationError(
          "UNGUARDED_NOT_APPLICABLE",
          `rule "${entry.ruleId}" reads ${entry.unguardedNotApplicablePaths.join(", ")} without guarding NOT_APPLICABLE`,
          entry.ruleId,
        ),
      };
    }
    for (const path of entry.indeterminateFactPaths) {
      blockingPaths.push({ path, slotFamily: entry.slotFamily });
    }
  }

  return ok({ flags, blockingPaths, familiesWithFlags });
}
