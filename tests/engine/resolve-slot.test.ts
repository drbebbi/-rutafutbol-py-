import { describe, expect, it } from "vitest";
import { resolveSlot, resolveSlots, type SlotCandidate } from "../../src/case-engine/precedence/resolve-slot";
import type { ProvenanceRef } from "../../src/domain/evaluation/provenance";
import { consequenceKeyOf } from "../../src/case-engine/canonicalization/ordering";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { id } from "../fixtures/ids";

type Consequence = Readonly<{ value: string }>;

function provenance(ruleId: string): ProvenanceRef {
  return { ruleId: id(ruleId), ruleRevisionId: id(`rev-${ruleId}`), sourceRevisionIds: [] };
}

function candidate(
  ruleId: string,
  overrides: Partial<SlotCandidate<Consequence>> = {},
): SlotCandidate<Consequence> & { provenance: ProvenanceRef } {
  const consequence = (overrides.consequence ?? { value: "A" }) as Consequence;
  return {
    slotKey: "SLOT",
    slotFamily: "CASE_TYPE",
    ruleId: id(ruleId),
    truth: "TRUE",
    support: "CONFIRMED",
    consequence,
    consequenceKey: consequenceKeyOf(consequence),
    indeterminateFactPaths: [],
    unguardedNotApplicablePaths: [],
    dominates: new Set<string>(),
    provenance: provenance(ruleId),
    ...overrides,
  };
}

describe("resolveSlot", () => {
  it("refuses to resolve a slot with no candidates", () => {
    const result = resolveSlot<Consequence>([]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("DECISION_CONFLICT");
  });

  it("ignores FALSE candidates entirely", () => {
    const resolution = unwrapOrThrow(resolveSlot([candidate("r.a", { truth: "FALSE" })]));
    expect(resolution.decided).toBeNull();
    expect(resolution.suppressedRuleIds).toEqual([]);
  });

  it("refuses when two groups each claim precedence over the other", () => {
    const result = resolveSlot([
      candidate("r.a", { dominates: new Set(["r.b"]) }),
      candidate("r.b", { consequence: { value: "B" }, consequenceKey: consequenceKeyOf({ value: "B" }), dominates: new Set(["r.a"]) }),
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("DECISION_CONFLICT");
  });

  it("reports every rule a confirmed winner takes precedence over", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([
        candidate("r.winner", { dominates: new Set(["r.loser", "r.elsewhere"]) }),
        candidate("r.loser", {
          consequence: { value: "B" },
          consequenceKey: consequenceKeyOf({ value: "B" }),
        }),
      ]),
    );
    expect(resolution.decided?.consequence).toEqual({ value: "A" });
    // Including rules that never entered this slot: an unresolved rule the
    // winner beats is silenced by the same report.
    expect(resolution.suppressedRuleIds).toEqual(["r.elsewhere", "r.loser"]);
  });

  it("reports nothing suppressed when the winner only merges with agreeing rules", () => {
    const resolution = unwrapOrThrow(resolveSlot([candidate("r.a"), candidate("r.b")]));
    expect(resolution.suppressedRuleIds).toEqual([]);
  });

  it("ignores an indeterminate candidate that the winner suppressed", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([
        candidate("r.winner", { dominates: new Set(["r.loser"]) }),
        candidate("r.loser", {
          consequence: { value: "B" },
          consequenceKey: consequenceKeyOf({ value: "B" }),
          truth: "INDETERMINATE",
          indeterminateFactPaths: ["case.maritalStatus"],
        }),
      ]),
    );
    // The winner already dominates the losing group, so the losing rule's
    // indeterminacy cannot change the answer.
    expect(resolution.decisionRelevantFactPaths).toEqual([]);
  });

  it("raises an unguarded NOT_APPLICABLE only when it would change the decision", () => {
    const harmless = unwrapOrThrow(
      resolveSlot([
        candidate("r.a"),
        candidate("r.b", {
          truth: "INDETERMINATE",
          unguardedNotApplicablePaths: ["case.location.countryCode"],
          indeterminateFactPaths: ["case.location.countryCode"],
        }),
      ]),
    );
    expect(harmless.decided?.consequence).toEqual({ value: "A" });

    const decisive = resolveSlot([
      candidate("r.a"),
      candidate("r.b", {
        truth: "INDETERMINATE",
        consequence: { value: "B" },
        consequenceKey: consequenceKeyOf({ value: "B" }),
        unguardedNotApplicablePaths: ["case.location.countryCode"],
        indeterminateFactPaths: ["case.location.countryCode"],
      }),
    ]);
    expect(!decisive.ok && decisive.error.code).toBe("UNGUARDED_NOT_APPLICABLE");
  });

  it("keeps an indeterminate candidate relevant when it could still decide the slot", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([
        candidate("r.maybe", {
          truth: "INDETERMINATE",
          indeterminateFactPaths: ["case.maritalStatus"],
        }),
      ]),
    );
    expect(resolution.decisionRelevantFactPaths).toEqual(["case.maritalStatus"]);
  });

  it("ignores an indeterminate candidate that agrees with the decision anyway", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([
        candidate("r.a"),
        candidate("r.agrees", {
          truth: "INDETERMINATE",
          indeterminateFactPaths: ["case.maritalStatus"],
        }),
      ]),
    );
    expect(resolution.decisionRelevantFactPaths).toEqual([]);
  });

  it("merges support and provenance across an agreeing group", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([candidate("r.a", { support: "STRONG_EVIDENCE" }), candidate("r.b")]),
    );
    expect(resolution.decided?.support).toBe("CONFIRMED");
    expect(resolution.decided?.provenance).toHaveLength(2);
  });

  it("groups candidates by slot key and returns slots in canonical order", () => {
    const resolutions = unwrapOrThrow(
      resolveSlots([
        candidate("r.b", { slotKey: "SLOT_B" }),
        candidate("r.a", { slotKey: "SLOT_A" }),
      ]),
    );
    expect(resolutions.map((resolution) => resolution.slotKey)).toEqual(["SLOT_A", "SLOT_B"]);
  });

  it("propagates a slot failure out of resolveSlots", () => {
    const result = resolveSlots([
      candidate("r.a", { slotKey: "SLOT_A" }),
      candidate("r.b", {
        slotKey: "SLOT_A",
        consequence: { value: "B" },
        consequenceKey: consequenceKeyOf({ value: "B" }),
      }),
    ]);
    expect(result.ok).toBe(false);
  });
});
