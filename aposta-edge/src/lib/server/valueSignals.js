// Pure value-signal construction. Every signal is derived from ONE prediction
// and the CURRENT selection rows (each linked to the immutable OddsSnapshot it
// came from). Every gate that fails is recorded in `suppression_reasons`; a
// signal can only carry a value status when that list is empty.
import { impliedProbability, noVigNormalize, fairOdds, margin } from "../oddsMath.js";
import { simpleEV, probabilityEdge } from "../valueEngine.js";
import { isOddsFresh, kickoffPassed, mappingConfident } from "./provenance.js";

export const SUPPORTED_MARKETS = [
  { market_key: "1x2", line: null, probKey: "1x2", selections: ["home", "draw", "away"] },
  { market_key: "over_under_goals", line: 2.5, probKey: "over_under_goals:2.5", selections: ["over", "under"] },
  { market_key: "btts", line: null, probKey: "btts", selections: ["yes", "no"] },
];

export const STRONG_VALUE_EV = 0.08;

export function signalKey(eventId, marketKey, line, selection) {
  return `${eventId}:${marketKey}:${line ?? ""}:${selection}`;
}

// Gates that apply to the whole event/prediction, independent of a market.
export function eventGateReasons({ event, prediction, nowMs = Date.now() }) {
  const reasons = [];
  if (!event) return ["event_missing"];
  if (event.status !== "scheduled") reasons.push(`event_${event.status || "unknown"}`);
  if (event.is_locked) reasons.push("event_locked");
  if (kickoffPassed(event, nowMs)) reasons.push("kickoff_passed");
  if (!mappingConfident(event)) reasons.push("mapping_unconfirmed");
  if (!prediction) reasons.push("prediction_missing");
  else {
    if (prediction.computation_status !== "computed") reasons.push("prediction_insufficient_data");
    const predictedAt = Date.parse(prediction.predicted_at);
    const kickoff = Date.parse(event.kickoff_utc);
    if (!Number.isFinite(predictedAt) || !Number.isFinite(kickoff) || predictedAt >= kickoff) reasons.push("prediction_not_pre_match");
    if (prediction.superseded_by) reasons.push("prediction_superseded");
  }
  return reasons;
}

// markets: [{ market, selections: [Selection rows] }]
export function buildValueSignals({ event, prediction, markets, nowMs = Date.now(), minEV = 0.03, calculatedAt = new Date(nowMs).toISOString() }) {
  const baseReasons = eventGateReasons({ event, prediction, nowMs });
  const signals = [];
  for (const spec of SUPPORTED_MARKETS) {
    const entry = (markets || []).find((m) => m.market?.market_key === spec.market_key && (m.market?.line ?? null) === spec.line && (m.market?.period ?? "full_time") === "full_time");
    if (!entry) continue;
    const { market } = entry;
    const byKey = Object.fromEntries((entry.selections || []).map((s) => [s.selection, s]));
    const marketReasons = [...baseReasons];
    if (market.status !== "open") marketReasons.push(`market_${market.status || "unknown"}`);
    const complete = spec.selections.every((k) => Number.isFinite(byKey[k]?.current_odds) && byKey[k].current_odds > 1);
    if (!complete) marketReasons.push("market_incomplete");
    const noVig = complete ? noVigNormalize(spec.selections.map((k) => impliedProbability(byKey[k].current_odds))) : null;
    const bookMargin = complete ? margin(spec.selections.map((k) => impliedProbability(byKey[k].current_odds))) : null;
    const probs = prediction?.market_probabilities?.[spec.probKey] || null;
    const intervals = prediction?.probability_intervals?.[spec.probKey] || null;

    for (const [i, sel] of spec.selections.entries()) {
      const row = byKey[sel];
      if (!row) continue;
      const reasons = [...marketReasons];
      if (row.status !== "open" || row.is_suspended) reasons.push(`selection_${row.is_suspended ? "suspended" : row.status || "unknown"}`);
      if (!row.current_snapshot_id) reasons.push("odds_snapshot_unlinked");
      if (!isOddsFresh(row.odds_observed_at, nowMs)) reasons.push("odds_stale");
      const modelProbability = probs?.[sel];
      if (!Number.isFinite(modelProbability)) reasons.push("model_probability_missing");
      const odds = row.current_odds;
      const ev = Number.isFinite(modelProbability) ? simpleEV(modelProbability, odds) : null;
      const band = intervals?.[sel];
      const evLower = band && Number.isFinite(odds) ? band[0] * odds - 1 : null;
      const noVigProb = noVig ? noVig[i] : null;
      let status;
      if (reasons.some((r) => r.startsWith("market_") || r.startsWith("selection_"))) status = "market_suspended";
      else if (reasons.includes("odds_stale")) status = "stale";
      else if (reasons.length > 0 || ev == null) status = "insufficient_data";
      else if (ev >= STRONG_VALUE_EV && evLower != null && evLower > 0) status = "strong_value";
      else if (ev >= minEV) status = "value";
      else if (ev >= 0) status = "watch";
      else status = "no_value";
      signals.push({
        event_id: event?.id, prediction_id: prediction?.id, market_id: market.id, selection_id: row.id,
        odds_snapshot_id: row.current_snapshot_id || null,
        market_snapshot_ids: spec.selections.map((k) => byKey[k]?.current_snapshot_id).filter(Boolean),
        signal_key: signalKey(event?.id, spec.market_key, spec.line, sel),
        market_key: spec.market_key, selection: sel, line: spec.line,
        aposta_odds: odds, aposta_no_vig_probability: noVigProb, bookmaker_margin: bookMargin,
        model_probability: Number.isFinite(modelProbability) ? modelProbability : null,
        probability_interval: band || null,
        probability_edge: Number.isFinite(modelProbability) && noVigProb != null ? probabilityEdge(modelProbability, noVigProb) : null,
        expected_value: ev, ev_lower: evLower,
        fair_odds: Number.isFinite(modelProbability) ? fairOdds(modelProbability) : null,
        odds_observed_at: row.odds_observed_at || null,
        status, suppression_reasons: reasons,
        confidence: confidenceFromEvidence({ ev, evLower, reasons, dataQuality: prediction?.data_quality }),
        data_quality: prediction?.data_quality || null,
        quality_adjusted_ev: evLower,
        calculated_at: calculatedAt, is_active: true,
      });
    }
  }
  return signals;
}

// Confidence label derived only from measured quantities:
//   high   — the whole ±1 SE probability band still yields positive EV and
//            lineups are confirmed;
//   medium — the band yields positive EV;
//   low    — otherwise.
// It is an ordinal label, NOT a probability of winning.
export function confidenceFromEvidence({ ev, evLower, reasons, dataQuality }) {
  if ((reasons && reasons.length) || !Number.isFinite(ev) || !Number.isFinite(evLower)) return "low";
  if (evLower > 0 && dataQuality?.lineup_quality === "confirmed") return "high";
  if (evLower > 0) return "medium";
  return "low";
}
