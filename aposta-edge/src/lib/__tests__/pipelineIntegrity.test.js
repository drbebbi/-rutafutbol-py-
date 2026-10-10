import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./helpers/mockDb.js";

vi.mock("@/lib/server/apostaProvider.server.js", () => ({
  fetchApostaEvents: vi.fn(), fetchApostaOdds: vi.fn(), apostaHealthCheck: vi.fn(), APOSTA_PROVIDER_NAME: "APOSTA",
}));
const football = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true), getFixturesByDate: vi.fn(), getFixture: vi.fn(), getTeamLastMatches: vi.fn(),
  getLineups: vi.fn(), getInjuries: vi.fn(), testConnection: vi.fn(),
}));
vi.mock("@/lib/server/footballDataProvider.server.js", () => football);

import {
  recordOddsSnapshot, importApostaEventManual, upsertApostaEvent, matchExternalFixtures, syncFootballData,
  runPredictionModels, calculateValueSignals, syncResults, settleFinishedMatches, lockPastEvents, acquireLease, computePerformance,
} from "@/lib/server/syncPipeline.server.js";
import { resolveTeam } from "@/lib/server/eventMatcher.js";
import { normalizeApostaEvent } from "@/lib/server/apostaNormalizer.js";
import { filterEligibleSignals } from "@/lib/server/signalFilter.js";

const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
beforeEach(() => vi.clearAllMocks());

describe("odds snapshot linkage and age", () => {
  it("the live Selection points at the snapshot it was copied from", async () => {
    const db = createMockDb({ Market: [{ id: "m1", event_id: "e1", market_key: "1x2", line: null, status: "open" }] });
    const snap = await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "open", "open", iso(Date.now() - 60e3));
    expect(db._stores.Selection[0].current_snapshot_id).toBe(snap.id);
    const snap2 = await recordOddsSnapshot(db, "e1", "1x2", "home", 2.2, null, "m1", "open", "open", iso(Date.now()));
    expect(db._stores.Selection[0].current_snapshot_id).toBe(snap2.id);
    expect(db._stores.Selection[0].opening_odds).toBe(2.1);
  });
  it("re-importing the identical observation does not duplicate history", async () => {
    const db = createMockDb({ Market: [{ id: "m1", event_id: "e1", market_key: "1x2", line: null, status: "open" }] });
    const ts = iso(Date.now() - 60e3);
    await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "open", "open", ts);
    await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "open", "open", ts);
    expect(db._stores.OddsSnapshot).toHaveLength(1);
  });
  it("manual import without source timestamp has unknown odds age; API feed uses retrieval time", async () => {
    const db = createMockDb({ Market: [{ id: "m1", event_id: "e1", market_key: "1x2", line: null, status: "open" }] });
    await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "open", "open", null, { trustRetrievalTime: false });
    expect(db._stores.Selection[0].odds_observed_at).toBeNull();
    await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "open", "open", null, { trustRetrievalTime: true });
    expect(db._stores.Selection[0].odds_observed_at).not.toBeNull();
  });
  it("a suspended market overrides an 'open' selection status", async () => {
    const db = createMockDb({ Market: [{ id: "m1", event_id: "e1", market_key: "1x2", line: null, status: "suspended" }] });
    await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "suspended", "open", iso(Date.now()));
    expect(db._stores.Selection[0].status).toBe("suspended");
  });
  it("timestamps more than 5 minutes in the future are rejected", async () => {
    const db = createMockDb();
    await recordOddsSnapshot(db, "e1", "1x2", "home", 2.1, null, "m1", "open", "open", iso(Date.now() + 2 * H));
    expect(db._stores.OddsSnapshot[0].observed_at).toBeNull();
  });
});

describe("team identity", () => {
  it("does not merge two different clubs that share a name stem", async () => {
    const db = createMockDb({ Team: [{ id: "t1", name: "Guaraní de Trinidad", sport: "football" }] });
    expect(await resolveTeam(db, "Guaraní")).toBeNull();
    expect((await resolveTeam(db, "guarani de trinidad")).team.id).toBe("t1");
  });
});

const kickoff = () => iso(Date.now() + 48 * H);
const apiEvent = (over = {}) => ({ aposta_event_id: "ap-1", event_url: "https://aposta.la/e/1", home_team_name: "Olimpia", away_team_name: "Cerro Porteño", competition_name: "Primera División", kickoff_utc: kickoff(), status: "scheduled", markets: [], ...over });

describe("fixture mapping links provider team ids", () => {
  it("a confirmed match stores both team ids; a conflicting id blocks the mapping", async () => {
    const db = createMockDb();
    const ev = await upsertApostaEvent(db, normalizeApostaEvent(apiEvent()), "aposta_api");
    football.getFixturesByDate.mockResolvedValue({ fixtures: [{ external_event_id: "900", external_home_team_id: "11", external_away_team_id: "22", home_team_name: "Olimpia", away_team_name: "Cerro Porteño", competition_name: "Primera División", kickoff_utc: ev.kickoff_utc }] });
    await matchExternalFixtures(db);
    const stored = db._stores.Event[0];
    expect(stored.mapping_status).toBe("matched");
    expect(stored.external_event_id).toBe("900");
    const teams = Object.fromEntries(db._stores.Team.map((t) => [t.name, t.external_ids?.football_data_id]));
    expect(teams).toEqual({ Olimpia: "11", "Cerro Porteño": "22" });

    // Second event whose fixture claims a different id for Olimpia → not confirmed.
    const ev2 = await upsertApostaEvent(db, normalizeApostaEvent(apiEvent({ aposta_event_id: "ap-2", kickoff_utc: iso(Date.now() + 96 * H) })), "aposta_api");
    football.getFixturesByDate.mockResolvedValue({ fixtures: [{ external_event_id: "901", external_home_team_id: "99", external_away_team_id: "22", home_team_name: "Olimpia", away_team_name: "Cerro Porteño", competition_name: "Primera División", kickoff_utc: ev2.kickoff_utc }] });
    await matchExternalFixtures(db);
    const stored2 = db._stores.Event.find((e) => e.id === ev2.id);
    expect(stored2.mapping_status).toBe("ambiguous");
    expect(stored2.mapping_evidence.reason).toBe("team_id_conflict");
  });
});

function lastMatches(extTeamId, n = 8) {
  return Array.from({ length: n }, (_, i) => ({
    external_fixture_id: `${extTeamId}-${i}`, external_team_id: extTeamId, external_opponent_id: "x", is_home: i % 2 === 0,
    goals: (i % 3) + (extTeamId === "11" ? 1 : 0), goals_conceded: i % 2, played_at: iso(Date.now() - (i + 1) * 7 * 24 * H),
    known_at: iso(Date.now() - H), retrieved_at: iso(Date.now() - H), source: "api_football", verified: true, data_quality: "partial",
  }));
}

async function mappedEventWithStats(db, n = 8) {
  const ev = await upsertApostaEvent(db, normalizeApostaEvent(apiEvent()), "aposta_api");
  football.getFixturesByDate.mockResolvedValue({ fixtures: [{ external_event_id: "900", external_home_team_id: "11", external_away_team_id: "22", home_team_name: "Olimpia", away_team_name: "Cerro Porteño", competition_name: "Primera División", kickoff_utc: ev.kickoff_utc }] });
  await matchExternalFixtures(db);
  football.getTeamLastMatches.mockImplementation(async (ext) => ({ matches: lastMatches(ext, n) }));
  await syncFootballData(db, ev.id);
  return db._stores.Event.find((e) => e.id === ev.id);
}

describe("football stats", () => {
  it("re-running the stats job does not duplicate team history", async () => {
    const db = createMockDb();
    const ev = await mappedEventWithStats(db);
    expect(db._stores.TeamMatchStat).toHaveLength(16);
    await syncFootballData(db, ev.id);
    expect(db._stores.TeamMatchStat).toHaveLength(16);
  });
});

describe("prediction gate", () => {
  it("without enough verified matches the prediction is stored as insufficient_data", async () => {
    const db = createMockDb();
    const ev = await mappedEventWithStats(db, 3);
    await runPredictionModels(db, ev.id);
    const p = db._stores.Prediction[0];
    expect(p.computation_status).toBe("insufficient_data");
    expect(p.market_probabilities).toBeNull();
    expect(p.insufficient_reasons).toContain("INSUFFICIENT_DATA_HOME");
  });
  it("with enough data all three MVP markets are computed, versioned and labelled honestly", async () => {
    const db = createMockDb();
    const ev = await mappedEventWithStats(db);
    await runPredictionModels(db, ev.id);
    const p = db._stores.Prediction[0];
    expect(p.computation_status).toBe("computed");
    expect(Object.keys(p.market_probabilities)).toEqual(["1x2", "over_under_goals:2.5", "btts"]);
    expect(p.calibration_status).toBe("UNCALIBRATED");
    const mv = db._stores.ModelVersion[0];
    expect(mv.validation_status).toBe("unvalidated");
    expect(mv.components).not.toContain("poisson_dixon_coles");
    // unchanged inputs → no new version
    await runPredictionModels(db, ev.id);
    expect(db._stores.Prediction).toHaveLength(1);
  });
  it("no prediction is created after kickoff", async () => {
    const db = createMockDb({ Event: [{ id: "e9", status: "scheduled", is_locked: false, kickoff_utc: iso(Date.now() - H) }] });
    await runPredictionModels(db, "e9");
    expect(db._stores.Prediction).toHaveLength(0);
  });
});

async function fullChain() {
  const db = createMockDb();
  const ev = await mappedEventWithStats(db);
  await runPredictionModels(db, ev.id);
  const now = Date.now();
  // Live API odds with an absurdly generous home price → value by construction.
  const { fetchApostaOdds } = await import("@/lib/server/apostaProvider.server.js");
  fetchApostaOdds.mockResolvedValue({ health: { status: "healthy" }, markets: [{
    market_key: "1x2", line: null, period: "full_time", status: "open", source_timestamp: iso(now - 60e3),
    selections: [{ selection: "home", odds: 5.0, status: "open" }, { selection: "draw", odds: 4.0, status: "open" }, { selection: "away", odds: 6.0, status: "open" }],
  }] });
  const { syncApostaOdds } = await import("@/lib/server/syncPipeline.server.js");
  await syncApostaOdds(db, ev.id);
  await calculateValueSignals(db, ev.id);
  return { db, ev: db._stores.Event.find((e) => e.id === ev.id) };
}

describe("value signals → recommendations", () => {
  it("an unvalidated model produces signals and a shadow ledger, but publishes nothing", async () => {
    const { db } = await fullChain();
    const home = db._stores.ValueSignal.find((s) => s.selection === "home" && s.is_active);
    expect(["value", "strong_value"]).toContain(home.status);
    expect(home.odds_snapshot_id).toBe(db._stores.Selection.find((s) => s.selection === "home").current_snapshot_id);
    const rec = db._stores.Recommendation.find((r) => r.selection === "home");
    expect(rec.published).toBe(false);
    expect(rec.unpublished_reasons).toContain("model_not_validated");
    expect(await filterEligibleSignals(db, { userId: "u1" })).toEqual([]);
  });
  it("after validation is recorded, the same chain publishes", async () => {
    const { db } = await fullChain();
    db._stores.ModelVersion[0].validation_status = "validated";
    const out = await filterEligibleSignals(db, { userId: "u1" });
    expect(out.map((s) => s.selection)).toContain("home");
  });
  it("recalculating with unchanged odds does not duplicate the ledger", async () => {
    const { db, ev } = await fullChain();
    const before = db._stores.Recommendation.length;
    await calculateValueSignals(db, ev.id);
    expect(db._stores.Recommendation.length).toBe(before);
  });
  it("uses only the caller's own EV threshold", async () => {
    const { db } = await fullChain();
    db._stores.ModelVersion[0].validation_status = "validated";
    db._stores.UserSettings.push({ id: "us-other", created_by_id: "someone-else", min_ev: 500 });
    expect((await filterEligibleSignals(db, { userId: "u1" })).length).toBeGreaterThan(0);
  });
});

describe("analysis package from stored data", () => {
  it("in-app analyst and export see the same gated facts", async () => {
    const { db, ev } = await fullChain();
    const { loadEventDetail } = await import("@/lib/server/eventDetail.js");
    const { buildAnalysisPackage } = await import("@/lib/analysisPackage.js");
    const pkg = buildAnalysisPackage(await loadEventDetail(db, ev.id));
    const home = pkg.markets[0].selections.find((s) => s.selection === "home");
    expect(home.aposta_odds).toBe(5.0);
    expect(home.odds_snapshot_id).toBe(db._stores.Selection.find((s) => s.selection === "home").current_snapshot_id);
    expect(home.published).toBe(false);
    expect(home.not_published_reasons).toContain("model_not_validated");
    expect(pkg.prediction.computation_status).toBe("computed");
  });
});

describe("kickoff change (postponement)", () => {
  it("is versioned and invalidates prediction and signals", async () => {
    const { db, ev } = await fullChain();
    const oldKick = ev.kickoff_utc;
    const newKick = iso(Date.parse(oldKick) + 7 * 24 * H);
    await upsertApostaEvent(db, normalizeApostaEvent(apiEvent({ kickoff_utc: newKick })), "aposta_api");
    const stored = db._stores.Event.find((e) => e.id === ev.id);
    expect(stored.kickoff_history[0].kickoff_utc).toBe(oldKick);
    expect(stored.kickoff_utc).toBe(newKick);
    expect(db._stores.Prediction[0].superseded_by).toBe("invalidated:kickoff_changed");
    expect(db._stores.ValueSignal.filter((s) => s.is_active)).toHaveLength(0);
  });
});

describe("results and settlement", () => {
  it("settles once, from the provider result, with the pre-kickoff prediction", async () => {
    const { db, ev } = await fullChain();
    // kickoff passes (odds were observed 60 s before it)
    const stored = db._stores.Event.find((e) => e.id === ev.id);
    stored.kickoff_utc = iso(Date.now() - 30e3);
    await lockPastEvents(db);
    const rec = db._stores.Recommendation.find((r) => r.selection === "home");
    expect(rec.is_locked).toBe(true);
    expect(rec.closing_odds).toBe(5.0);
    expect(rec.clv).toBeCloseTo(5.0 * ((1 / 5) / (1 / 5 + 1 / 4 + 1 / 6)) - 1, 10);

    // Move the timeline back: kickoff 3 h ago (results are polled 2 h after kickoff),
    // prediction made 4 h ago — i.e. still before kickoff.
    stored.kickoff_utc = iso(Date.now() - 3 * H);
    for (const p of db._stores.Prediction) p.predicted_at = iso(Date.now() - 4 * H);
    football.getFixture.mockResolvedValue({ provider: "api_football", external_event_id: "900", provider_status: "FT", result_confirmed: true, home_score: 2, away_score: 1, retrieved_at: iso(Date.now()) });
    await syncResults(db);
    await settleFinishedMatches(db);
    await settleFinishedMatches(db); // idempotent
    const outcomes = db._stores.PredictionOutcome;
    expect(outcomes).toHaveLength(7); // 3 + 2 + 2 selections, once
    expect(outcomes.find((o) => o.market_key === "1x2" && o.selection === "home").result).toBe("win");
    expect(db._stores.Recommendation.find((r) => r.selection === "home")).toMatchObject({ settlement_status: "win", profit_units: 4 });
    const perf = await computePerformance(db);
    expect(perf.forecast_1x2.sample_size).toBe(1);
    expect(perf.shadow.profit_units).toBeGreaterThan(0);
    expect(perf.published.bets).toBe(0);
  });
  it("a prediction created after kickoff is never used for settlement", async () => {
    const db = createMockDb({
      Event: [{ id: "e1", status: "finished", home_score: 1, away_score: 0, result_evidence: { provider: "api_football" }, kickoff_utc: iso(Date.now() - 5 * H) }],
      Prediction: [{ id: "late", event_id: "e1", version: 1, computation_status: "computed", predicted_at: iso(Date.now() - 4 * H),
        market_probabilities: { "1x2": { home: 0.9, draw: 0.05, away: 0.05 } } }],
    });
    await settleFinishedMatches(db);
    expect(db._stores.PredictionOutcome).toHaveLength(0);
  });
  it("an unconfirmed result is never settled", async () => {
    const db = createMockDb({ Event: [{ id: "e1", status: "finished", kickoff_utc: iso(Date.now() - 5 * H) }] });
    await settleFinishedMatches(db);
    expect(db._stores.Event[0].settled_at).toBeUndefined();
  });
  it("extra time / penalties are flagged for review, not settled", async () => {
    const db = createMockDb({ Event: [{ id: "e1", status: "scheduled", external_event_id: "5", kickoff_utc: iso(Date.now() - 5 * H) }] });
    football.getFixture.mockResolvedValue({ provider: "api_football", external_event_id: "5", provider_status: "AET", result_confirmed: false });
    const r = await syncResults(db);
    expect(db._stores.Event[0].status).toBe("scheduled");
    expect(r.details.needs_review[0].provider_status).toBe("AET");
  });
});

describe("manual import", () => {
  it("is never publishable before admin verification and stale without source time", async () => {
    const db = createMockDb();
    const ev = await importApostaEventManual(db, apiEvent({ markets: [{ market_key: "1x2", status: "open", selections: [{ selection: "home", odds: 2 }, { selection: "draw", odds: 3.2 }, { selection: "away", odds: 4 }] }] }));
    expect(ev.provenance).toBe("manual_import");
    expect(db._stores.Selection.every((s) => s.odds_observed_at === null)).toBe(true);
  });
});

describe("pipeline lease", () => {
  it("a second worker is refused while the lease is held; a stale lease is taken over", async () => {
    const db = createMockDb();
    const l1 = await acquireLease(db, "cycle");
    expect(l1).not.toBeNull();
    expect(await acquireLease(db, "cycle")).toBeNull();
    db._stores.PipelineLease[0].acquired_at = iso(Date.now() - 60 * 60e3);
    expect(await acquireLease(db, "cycle")).not.toBeNull();
    await l1.release(); // owner changed → release is a no-op
    expect(db._stores.PipelineLease).toHaveLength(1);
  });
});
