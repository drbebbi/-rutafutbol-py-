import { describe, it, expect } from "vitest";
import { buildAnalysisPackage, PACKAGE_SCHEMA } from "@/lib/analysisPackage.js";
import { APP_SYSTEM_PROMPT, STANDALONE_SYSTEM_PROMPT } from "@/lib/analystPrompts.js";

const event = { id: "e1", home_team_name: "Olimpia", away_team_name: "Cerro Porteño", kickoff_utc: "2026-10-12T22:00:00Z", status: "scheduled", aposta_event_url: "https://aposta.la/e/1" };
const market = { id: "m1", market_key: "1x2", line: null, status: "open", period: "full_time" };
const sels = ["home", "draw", "away"].map((k, i) => ({ id: `s-${k}`, market_id: "m1", selection: k, current_odds: [2.1, 3.4, 3.8][i], status: "open", odds_observed_at: "2026-10-10T12:00:00Z", current_snapshot_id: `snap-${k}` }));
const prediction = { computation_status: "computed", predicted_at: "2026-10-10T11:00:00Z", version: 2, lambda_home: 1.6, lambda_away: 1.0,
  market_probabilities: { "1x2": { home: 0.55, draw: 0.25, away: 0.2 } }, probability_intervals: { "1x2": { home: [0.5, 0.6], draw: [0.22, 0.28], away: [0.17, 0.23] } },
  feature_snapshot: { home: { sample_size: 10, avg_goals: 1.8, avg_goals_conceded: 0.9 }, away: { sample_size: 9, avg_goals: 1.1, avg_goals_conceded: 1.4 } }, score_distribution: [{ score: "1-1", prob: 0.12 }] };
const signals = [
  { market_key: "1x2", line: null, selection: "home", expected_value: 0.155, ev_lower: 0.05, status: "strong_value", published: false, gate_reasons: ["model_not_validated"], aposta_no_vig_probability: 0.45, fair_odds: 1.818, bookmaker_margin: 0.03 },
];
const detail = { event, markets: [market], selections: sels, predictions: [prediction], signals, provenance: { source: "aposta_api" }, verifiable: true, mapping_confident: true, odds_fresh: true, model_version: { label: "2.0.0", validation_status: "unvalidated", calibration_method: "none" } };

describe("analysis package", () => {
  it("carries Aposta odds with observation time, model numbers and the publication gate", () => {
    const p = buildAnalysisPackage(detail, "2026-10-10T12:05:00Z");
    expect(p.schema).toBe(PACKAGE_SCHEMA);
    expect(p.stake_rule).toBe("flat_1_unit");
    const home = p.markets[0].selections[0];
    expect(home).toMatchObject({ aposta_odds: 2.1, odds_observed_at: "2026-10-10T12:00:00Z", odds_snapshot_id: "snap-home", model_probability: 0.55, expected_value: 0.155, published: false, not_published_reasons: ["model_not_validated"] });
    expect(p.model.validation_status).toBe("unvalidated");
    expect(p.markets[1]).toEqual({ market_key: "over_under_goals", line: 2.5, available: false });
  });
  it("selections without a calculated signal are never marked published", () => {
    const draw = buildAnalysisPackage(detail).markets[0].selections[1];
    expect(draw.published).toBe(false);
    expect(draw.not_published_reasons).toEqual(["no_signal_calculated"]);
  });
  it("an insufficient-data prediction exposes no probabilities, only reasons", () => {
    const p = buildAnalysisPackage({ ...detail, predictions: [{ computation_status: "insufficient_data", insufficient_reasons: ["INSUFFICIENT_DATA_HOME"], market_probabilities: { "1x2": { home: 0.9 } } }] });
    expect(p.prediction.insufficient_reasons).toEqual(["INSUFFICIENT_DATA_HOME"]);
    expect(p.markets[0].selections[0].model_probability).toBeNull();
    expect(p.prediction.expected_goals_home).toBeNull();
  });
  it("no event → no package", () => {
    expect(buildAnalysisPackage(null)).toBeNull();
  });
});

describe("analyst prompts", () => {
  for (const [name, prompt] of [["app", APP_SYSTEM_PROMPT], ["standalone", STANDALONE_SYSTEM_PROMPT]]) {
    it(`${name}: Spanish, flat 1-unit stake, published-only recommendations, no invented numbers`, () => {
      expect(prompt).toMatch(/1 unidad/);
      expect(prompt).toMatch(/published = true/);
      expect(prompt).toMatch(/Nunca inventes/);
      expect(prompt).toMatch(/Apuesta con responsabilidad \(\+18\)/);
    });
  }
  it("standalone prompt only accepts the exported package", () => {
    expect(STANDALONE_SYSTEM_PROMPT).toContain(PACKAGE_SCHEMA);
  });
});
