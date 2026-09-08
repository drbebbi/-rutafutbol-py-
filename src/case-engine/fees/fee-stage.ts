import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { FeeComponentCode, RequiredProcedureKey } from "../../domain/identifiers/identifiers";
import { multiplyMoney, type Money } from "../../domain/primitives/money";
import { isBundleEligible } from "../../domain/rules/publication";
import { isSupportLevel, type SupportLevel } from "../../domain/rules/verification";
import type {
  FeeCalculation,
  FeeFormula,
  FeeIndexRevision,
  FeeType,
  FeeUnresolvedReason,
} from "../../domain/fees/fee";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { FeeConsequence as FeeRuleConsequence } from "../../rules/definitions/payloads";
import { compareStrings } from "../canonicalization/ordering";
import { ruleEvaluationError, type EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import {
  instancesOf,
  slotCandidate,
  statedConsequence,
  type StageContext,
} from "../evaluate/stage-context";
import { classifyTargetOutcome } from "../evaluate/target-outcome";
import { resolveProcedureTarget, type ProcedureIndex } from "../procedures/target-resolution";

type FeeConsequence = Readonly<{ feeType: FeeType; formula: FeeFormula }>;

export type FeeStageResult = Readonly<{
  feeCalculations: readonly FeeCalculation[];
  suppressedRuleIds: readonly string[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

function withinWindow(revision: FeeIndexRevision, on: LocalDate): boolean {
  const date = on as string;
  if (date < (revision.validFrom as string)) {
    return false;
  }
  return revision.validUntil === null || date <= (revision.validUntil as string);
}

type IndexResolution =
  | Readonly<{ state: "RESOLVED"; unitAmount: Money; support: SupportLevel }>
  | Readonly<{ state: "UNRESOLVED"; reason: FeeUnresolvedReason }>;

/**
 * Resolves a fee index to exactly one revision for the effective date.
 *
 * Zero revisions is FEE_INDEX_MISSING; more than one is FEE_INDEX_AMBIGUOUS.
 * Neither is guessed around: an unresolved index produces a null amount and a
 * verification flag, never an approximate number.
 */
export function resolveFeeIndex(
  revisions: readonly FeeIndexRevision[],
  feeIndexId: string,
  effectiveLocalDate: LocalDate,
): IndexResolution {
  const applicable = revisions.filter(
    (revision) =>
      (revision.feeIndexId as string) === feeIndexId &&
      isBundleEligible(revision.publicationStatus) &&
      withinWindow(revision, effectiveLocalDate),
  );
  if (applicable.length === 0) {
    return { state: "UNRESOLVED", reason: "FEE_INDEX_MISSING" };
  }
  if (applicable.length > 1) {
    return { state: "UNRESOLVED", reason: "FEE_INDEX_AMBIGUOUS" };
  }
  const revision = applicable[0] as FeeIndexRevision;
  if (!isSupportLevel(revision.verificationStatus)) {
    return { state: "UNRESOLVED", reason: "FEE_INDEX_UNRESOLVED_VERIFICATION" };
  }
  return { state: "RESOLVED", unitAmount: revision.unitAmount, support: revision.verificationStatus };
}

export function runFeeStage(
  stage: StageContext,
  procedureIndex: ProcedureIndex,
): Result<FeeStageResult, EngineError> {
  const candidates: (SlotCandidate<FeeConsequence> & { provenance: ProvenanceRef })[] = [];
  const slotMeta = new Map<
    string,
    Readonly<{ procedureKey: string; componentCode: string }>
  >();
  const relevantPaths = new Set<RuleFactPath>();

  for (const instance of instancesOf(stage, "FEE")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Grouped by family above; the cast records the invariant.
    const stated = statedConsequence<FeeRuleConsequence>(instance);
    if (stated === null) {
      continue;
    }
    const target = resolveProcedureTarget(
      stated.consequence.forProcedure,
      stage.view,
      instance.binding,
      procedureIndex,
      stage.engine,
    );
    if (!target.ok) {
      return target;
    }
    const decision = classifyTargetOutcome(
      target.value.state,
      instance.truth,
      instance.revision.ruleId,
      `fee targets procedure "${stated.consequence.forProcedure.procedureId}" (${target.value.state})`,
    );
    if (!decision.ok) {
      return decision;
    }
    if (decision.value === "SKIP") {
      if (instance.truth === "INDETERMINATE") {
        for (const path of instance.indeterminateFactPaths) {
          relevantPaths.add(path);
        }
      }
      continue;
    }
    const procedureKey = (target.value as { key: string }).key;
    const slotKey = `FEE:${procedureKey}:${stated.consequence.componentCode as string}`;
    slotMeta.set(slotKey, {
      procedureKey,
      componentCode: stated.consequence.componentCode as string,
    });
    candidates.push(
      slotCandidate<FeeConsequence>(instance, stated.support, slotKey, "FEE", {
        feeType: stated.consequence.feeType,
        formula: stated.consequence.formula,
      }),
    );
  }

  const resolved = resolveSlots(candidates);
  if (!resolved.ok) {
    return resolved;
  }

  const suppressedRuleIds = new Set<string>();
  const feeCalculations: FeeCalculation[] = [];

  for (const resolution of resolved.value) {
    const meta = slotMeta.get(resolution.slotKey);
    /* v8 ignore next 3 -- every slot key was registered above; the guard protects a future refactor. */
    if (meta === undefined) {
      continue;
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
    }
    if (resolution.decided === null) {
      continue;
    }

    const { feeType, formula } = resolution.decided.consequence;
    const base = {
      forProcedure: meta.procedureKey as RequiredProcedureKey,
      componentCode: meta.componentCode as FeeComponentCode,
      feeType,
      formula,
      support: resolution.decided.support,
      provenance: resolution.decided.provenance,
    };

    if (formula.kind === "FIXED") {
      feeCalculations.push({ ...base, calculatedAmount: formula.amount, unresolvedReason: null });
      continue;
    }
    if (formula.kind === "EXTERNAL_VARIABLE") {
      feeCalculations.push({
        ...base,
        calculatedAmount: null,
        unresolvedReason: "EXTERNAL_OR_VARIABLE",
      });
      continue;
    }

    const index = resolveFeeIndex(
      stage.bundle.feeIndexRevisions,
      formula.feeIndexId as string,
      stage.context.effectiveLocalDate,
    );
    if (index.state === "UNRESOLVED") {
      feeCalculations.push({ ...base, calculatedAmount: null, unresolvedReason: index.reason });
      continue;
    }
    const amount = multiplyMoney(index.unitAmount, formula.multiplier);
    if (!amount.ok) {
      return {
        ok: false,
        error: ruleEvaluationError("MONEY_OVERFLOW", amount.error.message),
      };
    }
    feeCalculations.push({
      ...base,
      // A confirmed rule multiplied by a strong-evidence index is only as
      // strong as its weakest input.
      support: index.support === "CONFIRMED" ? base.support : "STRONG_EVIDENCE",
      calculatedAmount: amount.value,
      unresolvedReason: null,
    });
  }

  return ok({
    feeCalculations: [...feeCalculations].sort((a, b) => {
      const byProcedure = compareStrings(a.forProcedure as string, b.forProcedure as string);
      return byProcedure !== 0
        ? byProcedure
        : compareStrings(a.componentCode as string, b.componentCode as string);
    }),
    suppressedRuleIds: [...suppressedRuleIds].sort(compareStrings),
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
