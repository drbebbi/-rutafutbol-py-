import { describe, expect, it } from "vitest";
import { canonicalProvenance, compareStrings, consequenceKeyOf, sortByKey } from "../../src/case-engine/canonicalization/ordering";
import { id } from "../fixtures/ids";
import type { ProvenanceRef } from "../../src/domain/evaluation/provenance";

const ref = (ruleId: string, revision: string, sources: readonly string[] = []): ProvenanceRef => ({
  ruleId: id(ruleId),
  ruleRevisionId: id(revision),
  sourceRevisionIds: sources.map((source) => id(source)),
});

describe("canonical provenance", () => {
  /**
   * Regression, found by the property suite: ordering must compare the
   * (ruleId, ruleRevisionId) tuple. Sorting a joined "ruleId|revisionId"
   * string collates "r.p1-dup" before "r.p1", because "-" sorts before "|".
   */
  it("orders by rule id first, not by a joined key", () => {
    const ordered = canonicalProvenance([
      ref("r.p1-dup", "00000000-0000-4000-8000-000000000002"),
      ref("r.p1", "00000000-0000-4000-8000-000000000001"),
    ]);
    expect(ordered.map((entry) => entry.ruleId as string)).toEqual(["r.p1", "r.p1-dup"]);
  });

  it("dedupes by rule revision and unions the cited sources", () => {
    const ordered = canonicalProvenance([
      ref("r.a", "00000000-0000-4000-8000-000000000001", ["00000000-0000-4000-8000-000000000101"]),
      ref("r.a", "00000000-0000-4000-8000-000000000001", ["00000000-0000-4000-8000-000000000100"]),
    ]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.sourceRevisionIds.map(String)).toEqual([
      "00000000-0000-4000-8000-000000000100",
      "00000000-0000-4000-8000-000000000101",
    ]);
  });

  it("dedupes repeated source ids inside a single reference", () => {
    const ordered = canonicalProvenance([
      ref("r.a", "00000000-0000-4000-8000-000000000001", [
        "00000000-0000-4000-8000-000000000100",
        "00000000-0000-4000-8000-000000000100",
      ]),
    ]);
    expect(ordered[0]?.sourceRevisionIds).toHaveLength(1);
  });

  it("breaks ties on rule revision id", () => {
    const ordered = canonicalProvenance([
      ref("r.a", "00000000-0000-4000-8000-000000000002"),
      ref("r.a", "00000000-0000-4000-8000-000000000001"),
    ]);
    expect(ordered.map((entry) => entry.ruleRevisionId as string)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });
});

describe("ordering helpers", () => {
  it("compares and sorts deterministically", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("a", "a")).toBe(0);
    expect(sortByKey([{ k: "b" }, { k: "a" }], (item) => item.k)).toEqual([{ k: "a" }, { k: "b" }]);
  });

  it("derives a semantic consequence key that ignores object key order", () => {
    expect(consequenceKeyOf({ a: 1, b: 2 })).toBe(consequenceKeyOf({ b: 2, a: 1 }));
    expect(consequenceKeyOf({ a: 1 })).not.toBe(consequenceKeyOf({ a: 2 }));
  });
});
