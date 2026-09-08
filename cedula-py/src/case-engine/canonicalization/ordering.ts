import { canonicalJsonStringify } from "../../shared/serialization/canonical-json";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";

/**
 * Canonical output ordering.
 *
 * Every array the engine returns is sorted by an explicit canonical identity.
 * Nothing may depend on database row order, rule array order, evidence order,
 * scope discovery order or `Map` insertion order.
 */
export function compareStrings(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortByKey<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((a, b) => compareStrings(key(a), key(b)));
}

/** Deduplicates provenance by rule revision and sorts it lexically. */
export function canonicalProvenance(refs: readonly ProvenanceRef[]): readonly ProvenanceRef[] {
  const byRevision = new Map<string, ProvenanceRef>();
  for (const ref of refs) {
    const key = ref.ruleRevisionId as string;
    const existing = byRevision.get(key);
    if (existing === undefined) {
      byRevision.set(key, {
        ruleId: ref.ruleId,
        ruleRevisionId: ref.ruleRevisionId,
        sourceRevisionIds: [...new Set(ref.sourceRevisionIds.map((id) => id as string))]
          .sort()
          .map((id) => id as ProvenanceRef["sourceRevisionIds"][number]),
      });
      continue;
    }
    const merged = new Set<string>([
      ...existing.sourceRevisionIds.map((id) => id as string),
      ...ref.sourceRevisionIds.map((id) => id as string),
    ]);
    byRevision.set(key, {
      ruleId: existing.ruleId,
      ruleRevisionId: existing.ruleRevisionId,
      sourceRevisionIds: [...merged].sort().map((id) => id as ProvenanceRef["sourceRevisionIds"][number]),
    });
  }
  return [...byRevision.values()].sort((a, b) => {
    const byRuleId = compareStrings(a.ruleId as string, b.ruleId as string);
    return byRuleId !== 0 ? byRuleId : compareStrings(a.ruleRevisionId as string, b.ruleRevisionId as string);
  });
}

/** Stable semantic identity of an arbitrary consequence value. */
export function consequenceKeyOf(value: unknown): string {
  return canonicalJsonStringify(value);
}
