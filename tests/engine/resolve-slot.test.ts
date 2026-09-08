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
    resolution: "RESOLVED_CONSEQUENCE",
    support: "CONFIRMED",
    unresolvedReason: null,
    verification: null,
    consequence,
    consequenceKey: consequenceKeyOf(consequence),
    indeterminateFactPaths: [],
    unguardedNotApplicablePaths: [],
    dominates: new Set<string>(),
    provenance: provenance(ruleId),
    ...overrides,
  };
}

function unresolved(ruleId: string, overrides: Partial<SlotCandidate<Consequence>> = {}) {
  return candidate(ruleId, {
    resolution: "UNRESOLVED_VERIFICATION",
    support: null,
    unresolvedReason: "CONFLICTING",
    verification: { code: "CASE_CLASSIFICATION_UNCONFIRMED", targetKind: "CASE" },
    consequence: null,
    consequenceKey: null,
    ...overrides,
  });
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
    expect(resolution.verifications).toEqual([]);
  });

  it("refuses when two groups each claim precedence over the other", () => {
    const result = resolveSlot([
      candidate("r.a", { dominates: new Set(["r.b"]) }),
      candidate("r.b", { consequence: { value: "B" }, consequenceKey: consequenceKeyOf({ value: "B" }), dominates: new Set(["r.a"]) }),
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("DECISION_CONFLICT");
  });

  it("silences an unresolved rule the multi-group winner directly dominates", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([
        candidate("r.winner", { dominates: new Set(["r.loser", "r.unresolved"]) }),
        candidate("r.loser", {
          consequence: { value: "B" },
          consequenceKey: consequenceKeyOf({ value: "B" }),
        }),
        unresolved("r.unresolved"),
      ]),
    );
    expect(resolution.decided?.consequence).toEqual({ value: "A" });
    expect(resolution.verifications).toEqual([]);
  });

  it("keeps an unresolved rule the winner does not dominate", () => {
    const resolution = unwrapOrThrow(
      resolveSlot([
        candidate("r.winner", { dominates: new Set(["r.loser"]) }),
        candidate("r.loser", {
          consequence: { value: "B" },
          consequenceKey: consequenceKeyOf({ value: "B" }),
        }),
        unresolved("r.unresolved"),
      ]),
    );
    expect(resolution.verifications).toHaveLength(1);
  });

  it("refuses an unresolved candidate that carries no verification declaration", () => {
    const result = resolveSlot([unresolved("r.a", { verification: null })]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("DECISION_CONFLICT");
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

  it("treats an indeterminate unresolved candidate as relevant only when nothing else asks for verification", () => {
    const alreadyFlagged = unwrapOrThrow(
      resolveSlot([
        unresolved("r.flagged"),
        unresolved("r.maybe", { truth: "INDETERMINATE", indeterminateFactPaths: ["case.maritalStatus"] }),
      ]),
    );
    expect(alreadyFlagged.decisionRelevantFactPaths).toEqual([]);

    const nothingFlagged = unwrapOrThrow(
      resolveSlot([unresolved("r.maybe", { truth: "INDETERMINATE", indeterminateFactPaths: ["case.maritalStatus"] })]),
    );
    expect(nothingFlagged.decisionRelevantFactPaths).toEqual(["case.maritalStatus"]);
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
