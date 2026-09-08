import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { VerificationFlag, Warning, WarningCode, WarningSeverity } from "../../domain/evaluation/issues";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { TimelineRulePayload, WarningRulePayload } from "../../rules/definitions/payloads";
import { compareStrings, consequenceKeyOf } from "../canonicalization/ordering";
import type { EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import { toVerificationFlag } from "../verification/flags";
import { dominatedRuleIds, instancesOf, type StageContext } from "../evaluate/stage-context";

type WarningConsequence = Readonly<{ code: WarningCode; severity: WarningSeverity }>;

export type WarningStageResult = Readonly<{
  warnings: readonly Warning[];
  verifications: readonly VerificationFlag[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

/**
 * Warnings and timelines.
 *
 * These are additive statements rather than exclusive decisions, but they
 * still go through slot resolution so that two rules stating contradictory
 * severities for the same warning are caught instead of both being shown.
 */
export function runWarningStage(stage: StageContext): Result<WarningStageResult, EngineError> {
  const candidates: (SlotCandidate<WarningConsequence> & { provenance: ProvenanceRef })[] = [];
  const qualifierBySlot = new Map<string, string | null>();

  for (const family of ["WARNING", "TIMELINE"] as const) {
    for (const instance of instancesOf(stage, family)) {
      if (instance.truth === "FALSE") {
        continue;
      }
      // Grouped by family above; the cast records the invariant.
      const payload = instance.revision.payload as WarningRulePayload | TimelineRulePayload;
      const qualifier = payload.consequence.qualifier;
      const slotKey = `WARNING:${payload.consequence.code}:${qualifier ?? "-"}`;
      qualifierBySlot.set(slotKey, qualifier);
      const consequence: WarningConsequence = {
        code: payload.consequence.code,
        severity: payload.consequence.severity,
      };
      candidates.push({
        slotKey,
        slotFamily: "WARNING",
        ruleId: instance.revision.ruleId,
        truth: instance.truth,
        resolution: instance.resolution,
        support: instance.support,
        unresolvedReason: instance.unresolvedReason,
        verification: instance.revision.verification,
        consequence: instance.resolution === "RESOLVED_CONSEQUENCE" ? consequence : null,
        consequenceKey:
          instance.resolution === "RESOLVED_CONSEQUENCE" ? consequenceKeyOf(consequence) : null,
        indeterminateFactPaths: instance.indeterminateFactPaths,
        unguardedNotApplicablePaths: instance.unguardedNotApplicablePaths,
        dominates: dominatedRuleIds(instance.revision),
        provenance: instance.provenance,
      });
    }
  }

  const resolved = resolveSlots(candidates);
  if (!resolved.ok) {
    return resolved;
  }

  const warnings: Warning[] = [];
  const verifications: VerificationFlag[] = [];
  const relevantPaths = new Set<RuleFactPath>();

  for (const resolution of resolved.value) {
    for (const verification of resolution.verifications) {
      verifications.push(toVerificationFlag(verification, {}));
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    if (resolution.decided === null) {
      continue;
    }
    warnings.push({
      code: resolution.decided.consequence.code,
      severity: resolution.decided.consequence.severity,
      qualifier: qualifierBySlot.get(resolution.slotKey) ?? null,
      provenance: resolution.decided.provenance,
    });
  }

  return ok({
    warnings: [...warnings].sort((a, b) =>
      compareStrings(`${a.code}|${a.qualifier ?? "-"}`, `${b.code}|${b.qualifier ?? "-"}`),
    ),
    verifications,
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
