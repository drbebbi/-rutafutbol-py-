import { describe, it, expect } from "vitest";
import { isDemoEvent, hasVerifiableProvenance, isOddsFresh, kickoffPassed, mappingConfident, predictionIsComputed, signalEligibility, describeProvenance } from "../server/provenance.js";

describe("provenance — demo detection", () => {
  it("flags sample aposta_event_id as demo", () => {
    expect(isDemoEvent({ aposta_event_id: "sample-1" })).toBe(true);
    expect(isDemoEvent({ aposta_event_id: "SAMPLE-2" })).toBe(true);
  });
  it("flags sample URL as demo", () => {
    expect(isDemoEvent({ aposta_event_id: "123", aposta_event_url: "https://aposta.la/sample-1" })).toBe(true);
  });
  it("does not flag a real event", () => {
    expect(isDemoEvent({ aposta_event_id: "987654", aposta_event_url: "https://aposta.la/event/987654" })).toBe(false);
  });
  it("respects an explicit provenance=demo flag", () => {
    expect(isDemoEvent({ aposta_event_id: "999", provenance: "demo" })).toBe(true);
  });
});

describe("provenance — verifiable source", () => {
  it("requires a real id, an https aposta.la URL and a verified origin", () => {
    expect(hasVerifiableProvenance({ provenance: "aposta_api", aposta_event_id: "123", aposta_event_url: "https://aposta.la/x" })).toBe(true);
    // id + URL alone are not evidence: unknown origin / unverified manual import
    expect(hasVerifiableProvenance({ aposta_event_id: "123", aposta_event_url: "https://aposta.la/x" })).toBe(false);
    expect(hasVerifiableProvenance({ provenance: "manual_import", aposta_event_id: "123", aposta_event_url: "https://aposta.la/x" })).toBe(false);
    expect(hasVerifiableProvenance({ provenance: "manual_import", aposta_event_id: "123", aposta_event_url: "https://aposta.la/x", source_verified_at: "2026-10-10T00:00:00Z", source_verified_by: "admin-1" })).toBe(true);
    // look-alike hosts and plain http are rejected
    expect(hasVerifiableProvenance({ provenance: "aposta_api", aposta_event_id: "123", aposta_event_url: "https://aposta.la.evil.com/x" })).toBe(false);
    expect(hasVerifiableProvenance({ provenance: "aposta_api", aposta_event_id: "123", aposta_event_url: "http://aposta.la/x" })).toBe(false);
    expect(hasVerifiableProvenance({ aposta_event_id: "123" })).toBe(false);
    expect(hasVerifiableProvenance({ aposta_event_id: "sample-1", aposta_event_url: "https://aposta.la/sample-1" })).toBe(false);
  });
});

describe("provenance — odds freshness (recomputed at read time)", () => {
  const now = Date.parse("2026-10-08T23:55:00Z");
  it("fresh when synced <30 min ago", () => {
    expect(isOddsFresh("2026-10-08T23:40:00Z", now)).toBe(true);
  });
  it("stale when synced >30 min ago", () => {
    expect(isOddsFresh("2026-10-08T22:02:00Z", now)).toBe(false);
  });
  it("missing when no sync timestamp", () => {
    expect(isOddsFresh(null, now)).toBe(false);
  });
});

describe("provenance — kickoff passed", () => {
  const now = Date.parse("2026-10-08T23:55:00Z");
  it("passed when kickoff is in the past", () => {
    expect(kickoffPassed({ kickoff_utc: "2026-10-08T23:36:44Z" }, now)).toBe(true);
  });
  it("not passed when kickoff is in the future", () => {
    expect(kickoffPassed({ kickoff_utc: "2026-10-09T20:00:00Z" }, now)).toBe(false);
  });
  it("treats unknown kickoff as passed (unsafe)", () => {
    expect(kickoffPassed({}, now)).toBe(true);
  });
});

describe("provenance — mapping confidence", () => {
  it("requires an external_event_id", () => {
    expect(mappingConfident({ mapping_confidence: 0.95 })).toBe(false);
  });
  it("requires confidence >= 0.85", () => {
    expect(mappingConfident({ external_event_id: "x", mapping_confidence: 0.7 })).toBe(false);
  });
  it("passes with both", () => {
    expect(mappingConfident({ external_event_id: "x", mapping_confidence: 0.9 })).toBe(true);
  });
});

describe("provenance — prediction computed", () => {
  it("false when feature_snapshot is null (seeded)", () => {
    expect(predictionIsComputed({ feature_snapshot: null })).toBe(false);
  });
  it("false when the pipeline ran but data was insufficient", () => {
    expect(predictionIsComputed({ feature_snapshot: { home: {} }, computation_status: "insufficient_data" })).toBe(false);
  });
  it("true only for computation_status = computed with a feature snapshot", () => {
    expect(predictionIsComputed({ feature_snapshot: { home: {} }, computation_status: "computed" })).toBe(true);
  });
});

describe("signalEligibility — the +1.4% EV case", () => {
  const realEvent = {
    provenance: "aposta_api",
    aposta_event_id: "987654", aposta_event_url: "https://aposta.la/event/987654",
    external_event_id: "ext-1", mapping_confidence: 0.9, is_locked: false,
    status: "scheduled", last_odds_sync_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    kickoff_utc: new Date(Date.now() + 86400000).toISOString(),
  };
  const computedPred = { feature_snapshot: { home: { sample_size: 6 } }, computation_status: "computed", model_version_id: "mv-1" };
  const freshObs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const selection = { id: "sel-1", current_snapshot_id: "snap-1" };
  const modelVersion = { id: "mv-1", validation_status: "validated" };
  const baseSignal = { is_active: true, expected_value: 0.014, status: "watch", odds_observed_at: freshObs, odds_snapshot_id: "snap-1", suppression_reasons: [] };

  it("0.52 * 1.95 - 1 = +1.4% EV exactly", () => {
    expect((0.52 * 1.95 - 1)).toBeCloseTo(0.014, 10);
  });
  it("suppresses a +1.4% EV signal under a 3% threshold (no VALUE)", () => {
    const { eligible, reasons } = signalEligibility({ signal: baseSignal, event: realEvent, prediction: computedPred, minEV: 0.03 });
    expect(eligible).toBe(false);
    expect(reasons).toContain("ev_below_threshold");
  });
  it("allows a +5% EV signal with full provenance", () => {
    const signal = { ...baseSignal, expected_value: 0.05, status: "value" };
    const { eligible, reasons } = signalEligibility({ signal, event: realEvent, prediction: computedPred, selection, modelVersion, minEV: 0.03 });
    expect(reasons).toEqual([]);
    expect(eligible).toBe(true);
  });
  it("suppresses when the model has no recorded validation", () => {
    const signal = { ...baseSignal, expected_value: 0.05, status: "value" };
    const { reasons } = signalEligibility({ signal, event: realEvent, prediction: computedPred, selection, modelVersion: { validation_status: "unvalidated" } });
    expect(reasons).toEqual(["model_not_validated"]);
  });
  it("suppresses when the odds moved after the signal was calculated", () => {
    const signal = { ...baseSignal, expected_value: 0.05, status: "value" };
    const { reasons } = signalEligibility({ signal, event: realEvent, prediction: computedPred, selection: { current_snapshot_id: "snap-2" }, modelVersion });
    expect(reasons).toEqual(["odds_changed_since_calculation"]);
  });
  it("judges freshness by the signal's odds observation, not the event sync time", () => {
    const signal = { ...baseSignal, expected_value: 0.05, status: "value", odds_observed_at: new Date(Date.now() - 3 * 3600e3).toISOString() };
    const { reasons } = signalEligibility({ signal, event: realEvent, prediction: computedPred, selection, modelVersion });
    expect(reasons).toEqual(["odds_stale"]);
  });
  it("suppresses a superseded prediction", () => {
    const signal = { ...baseSignal, expected_value: 0.05, status: "value" };
    const { reasons } = signalEligibility({ signal, event: realEvent, prediction: { ...computedPred, superseded_by: "p-2" }, selection, modelVersion });
    expect(reasons).toEqual(["prediction_superseded"]);
  });
  it("suppresses when data is demo regardless of EV", () => {
    const demoEvent = { ...realEvent, provenance: "demo" };
    const { eligible, reasons } = signalEligibility({ signal: { is_active: true, expected_value: 0.10 }, event: demoEvent, prediction: computedPred, minEV: 0.03 });
    expect(eligible).toBe(false);
    expect(reasons).toContain("demo_data");
  });
  it("suppresses when prediction was seeded (feature_snapshot null)", () => {
    const { eligible, reasons } = signalEligibility({ signal: baseSignal, event: realEvent, prediction: { feature_snapshot: null }, minEV: 0.01 });
    expect(eligible).toBe(false);
    expect(reasons).toContain("prediction_not_computed");
  });
  it("suppresses when kickoff has passed", () => {
    const pastEvent = { ...realEvent, kickoff_utc: new Date(Date.now() - 3600000).toISOString() };
    const { eligible, reasons } = signalEligibility({ signal: { is_active: true, expected_value: 0.05 }, event: pastEvent, prediction: computedPred, minEV: 0.03 });
    expect(eligible).toBe(false);
    expect(reasons).toContain("kickoff_passed");
  });
  it("suppresses when odds are stale", () => {
    const staleEvent = { ...realEvent, last_odds_sync_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() };
    const { eligible, reasons } = signalEligibility({ signal: { is_active: true, expected_value: 0.05 }, event: staleEvent, prediction: computedPred, minEV: 0.03 });
    expect(eligible).toBe(false);
    expect(reasons).toContain("odds_stale");
  });
  it("never alters the model probability", () => {
    const signal = { is_active: true, expected_value: 0.05, model_probability: 0.52 };
    signalEligibility({ signal, event: realEvent, prediction: computedPred, minEV: 0.03 });
    expect(signal.model_probability).toBe(0.52);
  });
});

describe("describeProvenance", () => {
  it("labels demo data", () => {
    expect(describeProvenance({ provenance: "demo" }).label).toBe("DEMO DATA");
  });
  it("labels unverified data", () => {
    expect(describeProvenance({}).label).toBe("Unverified");
  });
  it("labels manual import as unverified until an admin verifies it", () => {
    const base = { provenance: "manual_import", aposta_event_id: "1", aposta_event_url: "https://aposta.la/1" };
    expect(describeProvenance(base).verified).toBe(false);
    const p = describeProvenance({ ...base, source_verified_at: "2026-10-10T00:00:00Z", source_verified_by: "admin-1" });
    expect(p.verified).toBe(true);
  });
});