import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { Warning, WarningCode, WarningSeverity } from "../../domain/evaluation/issues";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { WarningConsequence as WarningRuleConsequence } from "../../rules/definitions/payloads";
import { compareStrings } from "../canonicalization/ordering";
import type { EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import {
  instancesOf,
  slotCandidate,
  statedConsequence,
  type StageContext,
} from "../evaluate/stage-context";

type WarningConsequence = Readonly<{ code: WarningCode; severity: WarningSeverity }>;

export type WarningStageResult = Readonly<{
  warnings: readonly Warning[];
  suppressedRuleIds: readonly string[];
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
      const stated = statedConsequence<WarningRuleConsequence>(instance);
      if (stated === null) {
        continue;
      }
      const qualifier = stated.consequence.qualifier;
      const slotKey = `WARNING:${stated.consequence.code}:${qualifier ?? "-"}`;
      qualifierBySlot.set(slotKey, qualifier);
      candidates.push(
        slotCandidate<WarningConsequence>(instance, stated.support, slotKey, "WARNING", {
          code: stated.consequence.code,
          severity: stated.consequence.severity,
        }),
      );
    }
  }

  const resolved = resolveSlots(candidates);
  if (!resolved.ok) {
    return resolved;
  }

  const warnings: Warning[] = [];
  const suppressedRuleIds = new Set<string>();
  const relevantPaths = new Set<RuleFactPath>();

  for (const resolution of resolved.value) {
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
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
    suppressedRuleIds: [...suppressedRuleIds].sort(compareStrings),
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
