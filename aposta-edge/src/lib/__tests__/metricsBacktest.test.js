import { describe, it, expect } from "vitest";
import { settleSelection, profitUnits, bettingSummary, forecastSummary, calibrationBins, expectedCalibrationError, logLoss } from "@/lib/metrics.js";
import { runBacktest, featuresAsOf, priceAt, holdoutBoundary, RESULT_DELAY_HOURS } from "@/lib/server/backtest.js";

describe("settlement", () => {
  it("1X2, BTTS and O/U 2.5", () => {
    expect(settleSelection({ market_key: "1x2", selection: "draw" }, 1, 1)).toBe("win");
    expect(settleSelection({ market_key: "1x2", selection: "home" }, 0, 1)).toBe("loss");
    expect(settleSelection({ market_key: "btts", selection: "yes" }, 2, 1)).toBe("win");
    expect(settleSelection({ market_key: "btts", selection: "no" }, 2, 0)).toBe("win");
    expect(settleSelection({ market_key: "over_under_goals", selection: "over", line: 2.5 }, 2, 1)).toBe("win");
    expect(settleSelection({ market_key: "over_under_goals", selection: "under", line: 2.5 }, 2, 1)).toBe("loss");
  });
  it("integer lines push, quarter lines are not settled automatically", () => {
    expect(settleSelection({ market_key: "over_under_goals", selection: "over", line: 3 }, 2, 1)).toBe("push");
    expect(settleSelection({ market_key: "over_under_goals", selection: "over", line: 2.25 }, 2, 1)).toBe("void");
  });
  it("regression: a missing score is NOT settled (old code returned 'away')", () => {
    expect(settleSelection({ market_key: "1x2", selection: "away" }, undefined, undefined)).toBeNull();
    expect(settleSelection({ market_key: "1x2", selection: "away" }, null, 1)).toBeNull();
  });
});

describe("betting summary (flat 1 unit)", () => {
  const bets = [
    { odds: 2.0, result: "win", settled_at: "2026-01-01", closing_no_vig_probability: 0.55 },
    { odds: 2.5, result: "loss", settled_at: "2026-01-02" },
    { odds: 2.5, result: "loss", settled_at: "2026-01-03" },
    { odds: 3.0, result: "win", settled_at: "2026-01-04", closing_no_vig_probability: 0.3 },
    { odds: 1.9, result: "push", settled_at: "2026-01-05" },
    { odds: 1.9, result: "void", settled_at: "2026-01-06" },
  ];
  const s = bettingSummary(bets);
  it("profit, yield and ROI follow one definition", () => {
    expect(s.profit_units).toBeCloseTo(1 - 1 - 1 + 2, 10);
    expect(s.staked_units).toBe(5); // void is not staked, push is
    expect(s.yield).toBeCloseTo(1 / 5, 10);
    expect(s.roi).toBe(s.yield);
    expect(s.hit_rate).toBeCloseTo(0.5, 10);
  });
  it("regression: 'yield' is a ratio, not the profit in units", () => {
    expect(s.yield).not.toBe(s.profit_units);
  });
  it("max drawdown is the largest peak-to-trough fall", () => {
    expect(s.max_drawdown_units).toBeCloseTo(2, 10); // +1 → −1
  });
  it("CLV = odds × closing no-vig probability − 1", () => {
    expect(s.avg_clv).toBeCloseTo(((2 * 0.55 - 1) + (3 * 0.3 - 1)) / 2, 10);
    expect(s.clv_sample_size).toBe(2);
  });
  it("profitUnits refuses invalid odds", () => {
    expect(profitUnits("win", 1)).toBeNull();
  });
});

describe("forecast scoring", () => {
  it("multiclass log loss and Brier, one row per match", () => {
    const f = [{ probs: { home: 0.5, draw: 0.3, away: 0.2 }, outcome: "home" }, { probs: { home: 0.5, draw: 0.3, away: 0.2 }, outcome: "away" }];
    const s = forecastSummary(f);
    expect(s.log_loss).toBeCloseTo((-Math.log(0.5) - Math.log(0.2)) / 2, 10);
    expect(s.brier_score).toBeCloseTo(((0.25 + 0.09 + 0.04) + (0.25 + 0.09 + 0.64)) / 2, 10);
    expect(s.accuracy).toBe(0.5);
  });
  it("uniform forecast log loss = ln 3", () => {
    expect(logLoss({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, "draw")).toBeCloseTo(Math.log(3), 10);
  });
  it("calibration bins and ECE", () => {
    const bins = calibrationBins([{ p: 0.15, y: 0 }, { p: 0.15, y: 1 }, { p: 0.85, y: 1 }], 10);
    expect(bins[1]).toMatchObject({ n: 2, observed: 0.5 });
    expect(bins[8]).toMatchObject({ n: 1, observed: 1 });
    expect(expectedCalibrationError(bins)).toBeCloseTo((2 / 3) * 0.35 + (1 / 3) * 0.15, 10);
  });
});

// --- backtest -------------------------------------------------------------------
// SYNTHETIC fixtures, used only to verify the mechanics (time cut-offs, splits).
// They say nothing about real model quality.
const D = 24 * 3600e3;
function synthLeague(rounds = 16) {
  const teams = ["A", "B", "C", "D"];
  const pairs = [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"], ["A", "D"], ["B", "C"]];
  const matches = [];
  let t = Date.parse("2026-01-03T18:00:00Z");
  for (let r = 0; r < rounds; r++) {
    for (const [h, a] of pairs.slice((r % 3) * 2, (r % 3) * 2 + 2)) {
      const hs = (r + h.charCodeAt(0)) % 4, as = (r * 3 + a.charCodeAt(0)) % 3;
      matches.push({ id: `m${matches.length}`, kickoff_utc: new Date(t).toISOString(), home_team_id: h, away_team_id: a, home_score: hs, away_score: as, competition: "Synthetic" });
    }
    t += 3.5 * D;
  }
  return { teams, matches };
}

describe("walk-forward backtest (STRICT_OBSERVED)", () => {
  it("features only use results known before the prediction time", () => {
    const { matches } = synthLeague();
    const target = matches[30];
    const tPred = Date.parse(target.kickoff_utc) - 24 * 3600e3;
    const f = featuresAsOf(matches, target.home_team_id, target.away_team_id, tPred);
    const used = new Set([...f.home.source_record_ids, ...f.away.source_record_ids]);
    for (const m of matches.filter((x) => used.has(x.id))) expect(Date.parse(m.kickoff_utc) + RESULT_DELAY_HOURS * 3600e3).toBeLessThanOrEqual(tPred);
    expect(used.has(target.id)).toBe(false);
  });
  it("changing a FUTURE result does not change any earlier prediction (no leakage)", () => {
    const { matches } = synthLeague();
    const a = runBacktest({ matches });
    const tampered = matches.map((m, i) => (i === matches.length - 1 ? { ...m, home_score: 9, away_score: 0 } : m));
    const b = runBacktest({ matches: tampered });
    const last = matches[matches.length - 1].id;
    const strip = (r) => r.predictions.filter((p) => p.match_id !== last);
    expect(strip(b)).toEqual(strip(a));
  });
  it("odds observed after the T−24h cut-off are not used; closing line is pre-kickoff", () => {
    const { matches } = synthLeague();
    const m = matches[20];
    const k = Date.parse(m.kickoff_utc);
    const odds = ["home", "draw", "away"].flatMap((s, i) => [
      { match_id: m.id, market_key: "1x2", line: null, selection: s, decimal_odds: [2, 3.4, 4][i], observed_at: new Date(k - 30 * 3600e3).toISOString() },
      { match_id: m.id, market_key: "1x2", line: null, selection: s, decimal_odds: [1.5, 4, 6][i], observed_at: new Date(k - 2 * 3600e3).toISOString() },
    ]);
    const spec = { key: "1x2", line: null, sels: ["home", "draw", "away"] };
    expect(priceAt(odds, m.id, spec, k - 24 * 3600e3)).toEqual({ home: 2, draw: 3.4, away: 4 });
    expect(priceAt(odds, m.id, spec, k, true)).toEqual({ home: 1.5, draw: 4, away: 6 });
    expect(priceAt(odds.filter((o) => o.selection !== "draw"), m.id, spec, k)).toBeNull(); // incomplete market
  });
  it("holdout boundary is fixed before evaluation and reported", () => {
    const { matches } = synthLeague();
    const boundary = holdoutBoundary(matches, 0.25);
    const r = runBacktest({ matches, holdoutFraction: 0.25 });
    expect(r.config.holdout_start).toBe(boundary);
    expect(r.config.mode).toBe("STRICT_OBSERVED");
    expect(r.development.model.sample_size + r.holdout.model.sample_size + r.development.skipped_insufficient_data + r.holdout.skipped_insufficient_data).toBe(matches.length);
    expect(r.development.skipped_insufficient_data).toBeGreaterThan(0); // early matches lack history
    expect(r.holdout.baseline_uniform.log_loss).toBeCloseTo(Math.log(3), 10);
  });
});
