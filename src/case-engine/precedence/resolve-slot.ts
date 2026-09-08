import { err, ok, type Result } from "../../shared/result/result";
import type { RuleId } from "../../domain/identifiers/identifiers";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import { mergeSupport, type SupportLevel } from "../../domain/rules/verification";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { DecisionSlotFamily } from "../../rules/definitions/payloads";
import { canonicalProvenance, compareStrings } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";

/**
 * A statement one rule makes about one decision slot.
 *
 * `consequenceKey` is the canonical semantic identity of the consequence: two
 * candidates with the same key are saying the same thing and merge; two with
 * different keys are in conflict and need explicit precedence.
 */
export type SlotCandidate<T> = Readonly<{
  slotKey: string;
  slotFamily: DecisionSlotFamily;
  ruleId: RuleId;
  truth: "TRUE" | "FALSE" | "INDETERMINATE";
  /**
   * Every candidate states a consequence.
   *
   * Rules that state no consequence never reach a slot at all: they are
   * verification requests, handled outside the precedence machinery, so there
   * is no code path here through which an unresolved rule could contribute to
   * a legal statement.
   */
  support: SupportLevel;
  consequence: T;
  consequenceKey: string;
  indeterminateFactPaths: readonly RuleFactPath[];
  /**
   * Paths that went indeterminate purely because they were NOT_APPLICABLE and
   * the rule never tested for it. Harmless while the rule is irrelevant;
   * a rule configuration error the moment it would change a decision.
   */
  unguardedNotApplicablePaths: readonly RuleFactPath[];
  /** Rule ids this rule declares precedence over (EXCEPTION_TO / OVERRIDES). */
  dominates: ReadonlySet<string>;
}>;

export type SlotResolution<T> = Readonly<{
  slotKey: string;
  slotFamily: DecisionSlotFamily;
  decided: Readonly<{
    consequence: T;
    consequenceKey: string;
    support: SupportLevel;
    provenance: readonly ProvenanceRef[];
  }> | null;
  /**
   * Rule ids a confirmed winner in this slot explicitly takes precedence over.
   *
   * Reported rather than consumed here, because a dominated rule may state a
   * verification request instead of a consequence, and those live outside the
   * slot. A rule the winner would beat anyway can neither block nor ask for
   * verification.
   */
  suppressedRuleIds: readonly string[];
  /**
   * Fact paths whose indeterminacy could still change this slot's outcome.
   * Only these become blocking issues; an indeterminate rule that could not
   * change the answer blocks nothing.
   */
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

type CandidateWithProvenance<T> = SlotCandidate<T> & Readonly<{ provenance: ProvenanceRef }>;

function groupsByConsequence<T>(
  candidates: readonly CandidateWithProvenance<T>[],
): ReadonlyMap<string, readonly CandidateWithProvenance<T>[]> {
  const groups = new Map<string, CandidateWithProvenance<T>[]>();
  for (const candidate of candidates) {
    const key = candidate.consequenceKey;
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }
  return groups;
}

/**
 * Resolves one decision slot.
 *
 * The order of operations matters and is fixed:
 *  1. identical consequences merge (support is promoted to CONFIRMED if any
 *     confirmed rule supports it, and all provenance is kept);
 *  2. incompatible consequences need an explicit, direct, confirmed winner;
 *  3. anything else is a DECISION_CONFLICT - never a first-match-wins.
 */
export function resolveSlot<T>(
  candidatesInput: readonly (SlotCandidate<T> & { provenance: ProvenanceRef })[],
): Result<SlotResolution<T>, EngineError> {
  const candidates = [...candidatesInput].sort((a, b) => compareStrings(a.ruleId as string, b.ruleId as string));
  const first = candidates[0];
  if (first === undefined) {
    return err(
      ruleConfigurationError("DECISION_CONFLICT", "resolveSlot called with no candidates"),
    );
  }

  const authoritative = candidates.filter((candidate) => candidate.truth === "TRUE");
  const indeterminate = candidates.filter((candidate) => candidate.truth === "INDETERMINATE");

  let winners: readonly CandidateWithProvenance<T>[] = authoritative;
  let suppressed = new Set<string>();

  if (authoritative.length > 0) {
    const groups = groupsByConsequence(authoritative);
    if (groups.size > 1) {
      const opposingByGroup = [...groups.entries()].sort((a, b) => compareStrings(a[0], b[0]));
      let winningKey: string | null = null;
      let winningRule: CandidateWithProvenance<T> | null = null;

      for (const [key, group] of opposingByGroup) {
        const opponents = authoritative.filter((candidate) => candidate.consequenceKey !== key);
        for (const candidate of group) {
          // Only a TRUE, CONFIRMED rule may suppress: STRONG_EVIDENCE never
          // overrides a contradicting confirmed rule.
          if (candidate.support !== "CONFIRMED") {
            continue;
          }
          const dominatesAll = opponents.every((opponent) =>
            candidate.dominates.has(opponent.ruleId as string),
          );
          if (dominatesAll) {
            if (winningKey !== null && winningKey !== key) {
              return err(
                ruleConfigurationError(
                  "DECISION_CONFLICT",
                  `slot ${first.slotKey}: two incompatible consequences each claim precedence`,
                  candidate.ruleId,
                ),
              );
            }
            winningKey = key;
            winningRule = candidate;
          }
        }
      }

      if (winningKey === null || winningRule === null) {
        const keys = [...groups.keys()].sort().join(" vs ");
        return err(
          ruleConfigurationError(
            "DECISION_CONFLICT",
            `slot ${first.slotKey}: incompatible consequences without direct confirmed precedence (${keys})`,
            first.ruleId,
          ),
        );
      }

      winners = groups.get(winningKey) as readonly CandidateWithProvenance<T>[];
      suppressed = new Set(
        authoritative
          .filter((candidate) => candidate.consequenceKey !== winningKey)
          .map((candidate) => candidate.ruleId as string),
      );
    }
  }

  /*
   * Anything a confirmed winner explicitly takes precedence over is silenced,
   * whatever its truth value: if the winner would still win when the other
   * rule turned out TRUE, that rule can neither raise a verification request
   * nor block on a fact - it could not change the answer.
   */
  for (const winner of winners) {
    if (winner.support !== "CONFIRMED") {
      continue;
    }
    for (const dominated of winner.dominates) {
      suppressed.add(dominated);
    }
  }

  const decided =
    winners.length > 0
      ? (() => {
          const head = winners[0] as CandidateWithProvenance<T>;
          const support = winners.reduce<SupportLevel>(
            (acc, candidate) => mergeSupport(acc, candidate.support),
            head.support,
          );
          return {
            consequence: head.consequence,
            consequenceKey: head.consequenceKey,
            support,
            provenance: canonicalProvenance(winners.map((candidate) => candidate.provenance)),
          };
        })()
      : null;

  /*
   * Decision-relevant indeterminacy.
   *
   * An indeterminate rule only blocks when its possible TRUE outcome could
   * change what this slot currently says: a different consequence, or a
   * consequence where there is none.
   */
  const relevantPaths = new Set<RuleFactPath>();
  for (const candidate of indeterminate) {
    if (suppressed.has(candidate.ruleId as string)) {
      continue;
    }
    const wouldChange = decided === null || candidate.consequenceKey !== decided.consequenceKey;
    if (!wouldChange) {
      continue;
    }
    if (candidate.unguardedNotApplicablePaths.length > 0) {
      // A NOT_APPLICABLE fact compared as a value leaves the rule stuck. That
      // is a modelling defect in the rule, not a question for the user, so it
      // must never surface as NEEDS_USER_INFORMATION.
      return err(
        ruleConfigurationError(
          "UNGUARDED_NOT_APPLICABLE",
          `rule "${candidate.ruleId}" reads ${candidate.unguardedNotApplicablePaths.join(", ")} without guarding NOT_APPLICABLE`,
          candidate.ruleId,
        ),
      );
    }
    for (const path of candidate.indeterminateFactPaths) {
      relevantPaths.add(path);
    }
  }

  return ok({
    slotKey: first.slotKey,
    slotFamily: first.slotFamily,
    decided,
    suppressedRuleIds: [...suppressed].sort(compareStrings),
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}

/** Groups candidates by slot key and resolves each slot deterministically. */
export function resolveSlots<T>(
  candidates: readonly (SlotCandidate<T> & { provenance: ProvenanceRef })[],
): Result<readonly SlotResolution<T>[], EngineError> {
  const bySlot = new Map<string, (SlotCandidate<T> & { provenance: ProvenanceRef })[]>();
  for (const candidate of candidates) {
    const list = bySlot.get(candidate.slotKey) ?? [];
    list.push(candidate);
    bySlot.set(candidate.slotKey, list);
  }
  const resolutions: SlotResolution<T>[] = [];
  for (const slotKey of [...bySlot.keys()].sort(compareStrings)) {
    const resolved = resolveSlot(bySlot.get(slotKey) as readonly (SlotCandidate<T> & { provenance: ProvenanceRef })[]);
    if (!resolved.ok) {
      return resolved;
    }
    resolutions.push(resolved.value);
  }
  return ok(resolutions);
}
