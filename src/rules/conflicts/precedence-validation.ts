import type { RuleId } from "../../domain/identifiers/identifiers";
import { decisionSlotFamilyForPayload } from "../definitions/payloads";
import type { RuleRevision } from "../definitions/rule-revision";

export type PrecedenceIssueCode =
  | "PRECEDENCE_TARGET_MISSING"
  | "PRECEDENCE_FAMILY_MISMATCH"
  | "PRECEDENCE_CYCLE";

export type PrecedenceIssue = Readonly<{
  code: PrecedenceIssueCode;
  ruleId: RuleId;
  detail: string;
}>;

/**
 * Validates the precedence graph of a candidate bundle.
 *
 * Cycles are rejected outright: `A overrides B overrides A` has no defensible
 * reading, so it is a rule configuration error rather than something the
 * evaluator should try to break by tie-break.
 *
 * Note that *transitivity* is deliberately not established here. The evaluator
 * requires a winner to dominate every opposing candidate directly; see
 * `case-engine/precedence`.
 */
export function validatePrecedenceGraph(
  revisions: readonly RuleRevision[],
): readonly PrecedenceIssue[] {
  const issues: PrecedenceIssue[] = [];
  const byRuleId = new Map<string, RuleRevision>();
  for (const revision of revisions) {
    byRuleId.set(revision.ruleId as string, revision);
  }

  const adjacency = new Map<string, string[]>();
  for (const revision of revisions) {
    const from = revision.ruleId as string;
    const targets: string[] = [];
    for (const edge of revision.payload.precedence) {
      const to = edge.overRuleId as string;
      const target = byRuleId.get(to);
      if (target === undefined) {
        issues.push({
          code: "PRECEDENCE_TARGET_MISSING",
          ruleId: revision.ruleId,
          detail: `precedence target "${to}" is not part of this bundle`,
        });
        continue;
      }
      const fromFamily = decisionSlotFamilyForPayload(revision.payload);
      const toFamily = decisionSlotFamilyForPayload(target.payload);
      if (fromFamily !== toFamily) {
        issues.push({
          code: "PRECEDENCE_FAMILY_MISMATCH",
          ruleId: revision.ruleId,
          detail: `${fromFamily} rule may not take precedence over ${toFamily} rule "${to}"`,
        });
        continue;
      }
      targets.push(to);
    }
    adjacency.set(from, targets.sort());
  }

  // Iterative DFS with an explicit colour map: white = unvisited,
  // grey = on the current stack, black = finished.
  const colour = new Map<string, "GREY" | "BLACK">();
  const reportedCycles = new Set<string>();

  const nodes = [...adjacency.keys()].sort();
  for (const start of nodes) {
    if (colour.get(start) !== undefined) {
      continue;
    }
    const stack: { node: string; index: number }[] = [{ node: start, index: 0 }];
    const path: string[] = [start];
    colour.set(start, "GREY");
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { node: string; index: number };
      const neighbours = adjacency.get(frame.node) ?? [];
      if (frame.index >= neighbours.length) {
        colour.set(frame.node, "BLACK");
        stack.pop();
        path.pop();
        continue;
      }
      const next = neighbours[frame.index] as string;
      frame.index += 1;
      const state = colour.get(next);
      if (state === "GREY") {
        const cycleStart = path.indexOf(next);
        const cycle = path.slice(cycleStart === -1 ? 0 : cycleStart).concat(next);
        const signature = [...cycle].sort().join(">");
        if (!reportedCycles.has(signature)) {
          reportedCycles.add(signature);
          issues.push({
            code: "PRECEDENCE_CYCLE",
            ruleId: frame.node as RuleId,
            detail: `precedence cycle: ${cycle.join(" -> ")}`,
          });
        }
        continue;
      }
      if (state === undefined) {
        colour.set(next, "GREY");
        path.push(next);
        stack.push({ node: next, index: 0 });
      }
    }
  }

  return issues;
}
