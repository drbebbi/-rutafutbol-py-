import { describe, it, expect } from "vitest";
import { eloToLambda, predictMatch, scoreMatrix } from "@/lib/predictionEngine.js";
import { buildModelLambdas, lambdaStandardErrors, predictAllMarkets, MIN_ELO_GAMES } from "@/lib/server/modelInputs.js";
import { buildValueSignals, eventGateReasons } from "@/lib/server/valueSignals.js";

const H = 3600e3;
const feat = (homeGoals, homeConc, awayGoals, awayConc, n = 8) => ({
  as_of: "2026-10-01T00:00:00Z",
  home: { sample_size: n, avg_goals: homeGoals, avg_goals_conceded: homeConc, source_record_ids: Array.from({ length: n }, (_, i) => `h${i}`) },
  away: { sample_size: n, avg_goals: awayGoals, avg_goals_conceded: awayConc, source_record_ids: Array.from({ length: n }, (_, i) => `a${i}`) },
});

describe("regression: unfitted defaults produced one identical forecast for every match", () => {
  it("the old pipeline input (Elo 1500 vs 1500, no stats) now yields NO prediction", () => {
    const m = buildModelLambdas({ features: { as_of: "2026-10-01T00:00:00Z", home: { sample_size: 0 }, away: { sample_size: 0 } }, homeTeam: { elo_rating: 1500 }, awayTeam: { elo_rating: 1500 } });
    expect(m.status).toBe("insufficient_data");
    expect(m.lambdas).toBeNull();
    expect(m.reasons).toEqual(["INSUFFICIENT_DATA_HOME", "INSUFFICIENT_DATA_AWAY"]);
  });
  it("Elo-derived goals now have a realistic total (old mapping: ~1.43 goals/match)", () => {
    const l = eloToLambda(1500, 1500);
    expect(l.lambdaHome + l.lambdaAway).toBeCloseTo(2.6, 6);
    const p = predictMatch(l.lambdaHome, l.lambdaAway);
    expect(p.overUnder25.under).toBeLessThan(0.6); // old value: 0.827
  });
  it("an unfitted Elo rating (elo_games below minimum) is ignored", () => {
    const f = feat(1.5, 1.0, 1.2, 1.3);
    const withPrior = buildModelLambdas({ features: f, homeTeam: { elo_rating: 1800, elo_games: 0 }, awayTeam: { elo_rating: 1200, elo_games: 0 } });
    const without = buildModelLambdas({ features: f });
    expect(withPrior.lambdas).toEqual(without.lambdas);
    expect(withPrior.components.elo).toBeNull();
  });
  it("a fitted Elo rating is blended with weight 0.3", () => {
    const f = feat(1.5, 1.0, 1.2, 1.3);
    const m = buildModelLambdas({ features: f, homeTeam: { elo_rating: 1600, elo_games: MIN_ELO_GAMES }, awayTeam: { elo_rating: 1500, elo_games: 20 } });
    expect(m.components.weights).toEqual({ feature: 0.7, elo: 0.3 });
    expect(m.lambdas.lambdaHome).toBeCloseTo(0.7 * m.components.feature.lambdaHome + 0.3 * m.components.elo.lambdaHome, 10);
  });
  it("different teams get different forecasts", () => {
    const a = predictAllMarkets(buildModelLambdas({ features: feat(2.2, 0.6, 0.8, 1.9) }).lambdas).probabilities;
    const b = predictAllMarkets(buildModelLambdas({ features: feat(0.7, 1.8, 1.9, 0.7) }).lambdas).probabilities;
    expect(a["1x2"].home).toBeGreaterThan(0.6);
    expect(b["1x2"].away).toBeGreaterThan(0.45);
  });
});

describe("score matrix numerics", () => {
  it("high-scoring lambdas no longer throw EXCESSIVE_TRUNCATED_MASS", () => {
    expect(() => scoreMatrix(4.5, 3.5)).not.toThrow();
    expect(scoreMatrix(4.5, 3.5).tail_mass).toBeLessThan(1e-4);
  });
  it("all market probabilities sum to 1", () => {
    const p = predictAllMarkets({ lambdaHome: 1.7, lambdaAway: 0.9 }).probabilities;
    for (const sels of Object.values(p)) expect(Object.values(sels).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe("statistical uncertainty band", () => {
  it("SE shrinks with sample size and the band contains the point estimate", () => {
    const small = lambdaStandardErrors(feat(1.5, 1, 1.2, 1.3, 6));
    const large = lambdaStandardErrors(feat(1.5, 1, 1.2, 1.3, 30));
    expect(large.home).toBeLessThan(small.home);
    const f = feat(1.5, 1, 1.2, 1.3, 8);
    const out = predictAllMarkets(buildModelLambdas({ features: f }).lambdas, lambdaStandardErrors(f));
    for (const [mk, sels] of Object.entries(out.probabilities)) for (const [s, p] of Object.entries(sels)) {
      const [lo, hi] = out.intervals[mk][s];
      expect(lo).toBeLessThanOrEqual(p);
      expect(hi).toBeGreaterThanOrEqual(p);
    }
  });
});

// --- value signals -------------------------------------------------------------
const NOW = Date.parse("2026-10-10T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const event = { id: "ev1", status: "scheduled", is_locked: false, kickoff_utc: iso(NOW + 24 * H), external_event_id: "123", mapping_confidence: 1 };
const prediction = {
  id: "p1", computation_status: "computed", predicted_at: iso(NOW - H), superseded_by: null,
  market_probabilities: { "1x2": { home: 0.55, draw: 0.25, away: 0.2 }, "over_under_goals:2.5": { over: 0.5, under: 0.5 }, btts: { yes: 0.5, no: 0.5 } },
  probability_intervals: { "1x2": { home: [0.5, 0.6], draw: [0.22, 0.28], away: [0.17, 0.23] } },
};
const sel = (selection, odds, extra = {}) => ({ id: `s-${selection}`, selection, current_odds: odds, status: "open", is_suspended: false, current_snapshot_id: `snap-${selection}`, odds_observed_at: iso(NOW - 5 * 60e3), ...extra });
const market1x2 = (sels, status = "open") => ({ market: { id: "m1", market_key: "1x2", line: null, status, period: "full_time" }, selections: sels });
const build = (over = {}) => buildValueSignals({ event, prediction, markets: [market1x2([sel("home", 2.1), sel("draw", 3.6), sel("away", 4.2)])], nowMs: NOW, ...over });

describe("buildValueSignals", () => {
  it("computes the example from the brief: 0.55 × 2.10 − 1 = +15.5 %", () => {
    const home = build().find((s) => s.selection === "home");
    expect(home.expected_value).toBeCloseTo(0.155, 10);
    expect(home.suppression_reasons).toEqual([]);
    expect(home.status).toBe("strong_value"); // band lower bound 0.5 × 2.1 − 1 = +5 % > 0
    expect(home.ev_lower).toBeCloseTo(0.05, 10);
    expect(home.odds_snapshot_id).toBe("snap-home");
    expect(home.market_snapshot_ids).toEqual(["snap-home", "snap-draw", "snap-away"]);
    expect(home.bookmaker_margin).toBeCloseTo(1 / 2.1 + 1 / 3.6 + 1 / 4.2 - 1, 10);
  });
  it("a missing market side no longer crashes and blocks the market", () => {
    const sigs = build({ markets: [market1x2([sel("home", 2.1), sel("away", 4.2)])] });
    expect(sigs).toHaveLength(2);
    for (const s of sigs) { expect(s.suppression_reasons).toContain("market_incomplete"); expect(s.status).toBe("market_suspended"); expect(s.aposta_no_vig_probability).toBeNull(); }
  });
  it("a suspended or unknown-status market is never value", () => {
    for (const status of ["suspended", "unknown", "missing"]) {
      const s = build({ markets: [market1x2([sel("home", 2.1), sel("draw", 3.6), sel("away", 4.2)], status)] }).find((x) => x.selection === "home");
      expect(s.status).toBe("market_suspended");
      expect(s.suppression_reasons).toContain(`market_${status}`);
    }
  });
  it("a suspended selection is never value", () => {
    const s = build({ markets: [market1x2([sel("home", 2.1, { status: "suspended", is_suspended: true }), sel("draw", 3.6), sel("away", 4.2)])] }).find((x) => x.selection === "home");
    expect(s.suppression_reasons).toContain("selection_suspended");
  });
  it("odds of unknown age (manual import without source timestamp) are stale", () => {
    const s = build({ markets: [market1x2([sel("home", 2.1, { odds_observed_at: null }), sel("draw", 3.6), sel("away", 4.2)])] }).find((x) => x.selection === "home");
    expect(s.status).toBe("stale");
  });
  it("odds not linked to a snapshot are not usable", () => {
    const s = build({ markets: [market1x2([sel("home", 2.1, { current_snapshot_id: null }), sel("draw", 3.6), sel("away", 4.2)])] }).find((x) => x.selection === "home");
    expect(s.suppression_reasons).toContain("odds_snapshot_unlinked");
  });
  it("blocks after kickoff, for non-pre-match predictions and insufficient data", () => {
    expect(eventGateReasons({ event, prediction, nowMs: NOW + 25 * H })).toContain("kickoff_passed");
    expect(eventGateReasons({ event, prediction: { ...prediction, predicted_at: iso(NOW + 25 * H) }, nowMs: NOW })).toContain("prediction_not_pre_match");
    expect(eventGateReasons({ event, prediction: { ...prediction, computation_status: "insufficient_data" }, nowMs: NOW })).toContain("prediction_insufficient_data");
    expect(eventGateReasons({ event: { ...event, status: "postponed" }, prediction, nowMs: NOW })).toContain("event_postponed");
    expect(eventGateReasons({ event: { ...event, external_event_id: null }, prediction, nowMs: NOW })).toContain("mapping_unconfirmed");
  });
  it("without probabilities for a market there is no EV and no value status", () => {
    const s = buildValueSignals({ event, prediction: { ...prediction, market_probabilities: null }, markets: [market1x2([sel("home", 2.1), sel("draw", 3.6), sel("away", 4.2)])], nowMs: NOW });
    expect(s.every((x) => x.status === "insufficient_data" && x.expected_value == null)).toBe(true);
  });
  it("only Over/Under 2.5 full-time is evaluated; other lines are ignored", () => {
    const ou = (line) => ({ market: { id: `ou${line}`, market_key: "over_under_goals", line, status: "open" }, selections: [sel("over", 1.9), sel("under", 1.9)] });
    const sigs = buildValueSignals({ event, prediction, markets: [ou(2.5), ou(3)], nowMs: NOW });
    expect(sigs.map((s) => s.line)).toEqual([2.5, 2.5]);
  });
});
