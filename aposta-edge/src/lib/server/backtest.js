// Reproducible walk-forward backtest. Pure — no database, no network.
//
// Input: historical matches with confirmed results and (optionally) timestamped
// odds observations. The SAME model code as production (features → lambdas →
// Poisson) is used; nothing is fitted on the evaluation match.
//
// Temporal rules (STRICT_OBSERVED):
//   * prediction time  t_pred = kickoff − cutoffHours (default T−24h)
//   * a past match may be used as a feature only if its result was known before
//     t_pred: kickoff + RESULT_DELAY_HOURS ≤ t_pred
//   * the odds used are the latest observation with observed_at ≤ t_pred; the
//     closing line is the latest observation with observed_at < kickoff
//   * the holdout boundary is a DATE fixed by the caller (or derived once from
//     holdoutFraction over the chronologically sorted input) — never chosen
//     after looking at results.
import { validateFeatures, MIN_TEAM_SAMPLE } from "./features.js";
import { buildModelLambdas, predictAllMarkets } from "./modelInputs.js";
import { impliedProbability, noVigNormalize } from "../oddsMath.js";
import { outcome1x2, settleSelection, bettingSummary, forecastSummary, calibrationBins, expectedCalibrationError } from "../metrics.js";

export const RESULT_DELAY_HOURS = 3;
const H = 3600 * 1000;

const MARKETS = [
  { key: "1x2", line: null, probKey: "1x2", sels: ["home", "draw", "away"] },
  { key: "over_under_goals", line: 2.5, probKey: "over_under_goals:2.5", sels: ["over", "under"] },
  { key: "btts", line: null, probKey: "btts", sels: ["yes", "no"] },
];

// matches: [{ id, kickoff_utc, home_team_id, away_team_id, home_score, away_score, competition? }]
export function featuresAsOf(matches, homeId, awayId, asOfMs, window = 10) {
  const features = { as_of: new Date(asOfMs).toISOString(), minimum_sample: MIN_TEAM_SAMPLE };
  for (const [side, teamId] of [["home", homeId], ["away", awayId]]) {
    const rows = matches
      .filter((m) => (m.home_team_id === teamId || m.away_team_id === teamId) &&
        Date.parse(m.kickoff_utc) + RESULT_DELAY_HOURS * H <= asOfMs && outcome1x2(m.home_score, m.away_score) != null)
      .sort((a, b) => Date.parse(b.kickoff_utc) - Date.parse(a.kickoff_utc))
      .slice(0, window);
    const goals = rows.map((m) => (m.home_team_id === teamId ? m.home_score : m.away_score));
    const conceded = rows.map((m) => (m.home_team_id === teamId ? m.away_score : m.home_score));
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    features[side] = { sample_size: rows.length, avg_goals: mean(goals), avg_goals_conceded: mean(conceded), source_record_ids: rows.map((m) => m.id) };
  }
  return features;
}

// odds: [{ match_id, market_key, line, selection, decimal_odds, observed_at }]
export function priceAt(odds, matchId, market, atMs, strictlyBefore = false) {
  const out = {};
  for (const sel of market.sels) {
    const obs = odds
      .filter((o) => o.match_id === matchId && o.market_key === market.key && (o.line ?? null) === market.line && o.selection === sel &&
        Number.isFinite(Date.parse(o.observed_at)) && (strictlyBefore ? Date.parse(o.observed_at) < atMs : Date.parse(o.observed_at) <= atMs))
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
    if (!obs || !(obs.decimal_odds > 1)) return null; // incomplete market → no price
    out[sel] = obs.decimal_odds;
  }
  return out;
}

const noVigOf = (price, sels) => {
  const nv = noVigNormalize(sels.map((s) => impliedProbability(price[s])));
  return nv ? Object.fromEntries(sels.map((s, i) => [s, nv[i]])) : null;
};

export function holdoutBoundary(matches, holdoutFraction = 0.2) {
  const sorted = [...matches].sort((a, b) => Date.parse(a.kickoff_utc) - Date.parse(b.kickoff_utc));
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length * (1 - holdoutFraction))]?.kickoff_utc ?? null;
}

export function runBacktest({ matches, odds = [], cutoffHours = 24, holdoutStart = null, holdoutFraction = 0.2, minEV = 0.03 }) {
  const sorted = [...matches].sort((a, b) => Date.parse(a.kickoff_utc) - Date.parse(b.kickoff_utc));
  const boundary = holdoutStart ?? holdoutBoundary(sorted, holdoutFraction);
  const segments = { development: { forecasts: [], baselineUniform: [], baselineMarket: [], pairs: [], bets: [], skipped: 0 },
    holdout: { forecasts: [], baselineUniform: [], baselineMarket: [], pairs: [], bets: [], skipped: 0 } };
  const predictions = [];

  for (const m of sorted) {
    const outcome = outcome1x2(m.home_score, m.away_score);
    if (outcome == null) continue;
    const kickoffMs = Date.parse(m.kickoff_utc);
    const tPred = kickoffMs - cutoffHours * H;
    const seg = boundary && m.kickoff_utc >= boundary ? segments.holdout : segments.development;
    const features = featuresAsOf(sorted, m.home_team_id, m.away_team_id, tPred);
    if (!validateFeatures(features).valid) { seg.skipped++; continue; }
    const model = buildModelLambdas({ features });
    const { probabilities } = predictAllMarkets(model.lambdas);
    predictions.push({ match_id: m.id, predicted_at: new Date(tPred).toISOString(), feature_ids: [...features.home.source_record_ids, ...features.away.source_record_ids], probabilities });

    seg.forecasts.push({ probs: probabilities["1x2"], outcome });
    seg.baselineUniform.push({ probs: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, outcome });
    for (const sel of ["home", "draw", "away"]) seg.pairs.push({ p: probabilities["1x2"][sel], y: sel === outcome ? 1 : 0 });

    for (const market of MARKETS) {
      const price = priceAt(odds, m.id, market, tPred);
      if (!price) continue;
      const nv = noVigOf(price, market.sels);
      if (market.key === "1x2" && nv) seg.baselineMarket.push({ probs: nv, outcome });
      const closing = priceAt(odds, m.id, market, kickoffMs, true);
      const closingNv = closing ? noVigOf(closing, market.sels) : null;
      for (const sel of market.sels) {
        const p = probabilities[market.probKey][sel];
        const ev = p * price[sel] - 1;
        if (ev < minEV) continue;
        seg.bets.push({ match_id: m.id, market_key: market.key, line: market.line, selection: sel, odds: price[sel], model_probability: p, ev,
          result: settleSelection({ market_key: market.key, selection: sel, line: market.line }, m.home_score, m.away_score),
          settled_at: m.kickoff_utc, closing_no_vig_probability: closingNv?.[sel] ?? null, competition: m.competition ?? null });
      }
    }
  }

  const report = (s) => {
    const bins = calibrationBins(s.pairs);
    const byMarket = {};
    for (const b of s.bets) (byMarket[b.market_key] ??= []).push(b);
    const byCompetition = {};
    for (const b of s.bets) (byCompetition[b.competition ?? "unknown"] ??= []).push(b);
    return {
      model: forecastSummary(s.forecasts),
      baseline_uniform: forecastSummary(s.baselineUniform),
      baseline_market_no_vig: forecastSummary(s.baselineMarket),
      calibration: { bins, ece: expectedCalibrationError(bins) },
      betting: bettingSummary(s.bets),
      betting_by_market: Object.fromEntries(Object.entries(byMarket).map(([k, v]) => [k, bettingSummary(v)])),
      betting_by_competition: Object.fromEntries(Object.entries(byCompetition).map(([k, v]) => [k, bettingSummary(v)])),
      skipped_insufficient_data: s.skipped,
    };
  };

  return {
    config: { cutoff_hours: cutoffHours, holdout_start: boundary, min_ev: minEV, result_delay_hours: RESULT_DELAY_HOURS, mode: "STRICT_OBSERVED" },
    development: report(segments.development),
    holdout: report(segments.holdout),
    predictions,
  };
}
