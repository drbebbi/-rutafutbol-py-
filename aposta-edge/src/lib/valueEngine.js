// Value-bet and recommendation logic. Deterministic — no LLM.
import { impliedProbability, noVigNormalize, clampProbability, validProbability, validOdds } from "@/lib/oddsMath";

// Simple binary-market EV: (model_prob * odds) - 1
export function simpleEV(modelProbability, decimalOdds) {
  if (!validProbability(modelProbability) || !validOdds(decimalOdds)) return null;
  return modelProbability * decimalOdds - 1;
}

// Probability edge vs the no-vig market probability (in percentage points, fraction).
export function probabilityEdge(modelProbability, noVigProbability) {
  if (!validProbability(modelProbability) || !validProbability(noVigProbability)) return null;
  return modelProbability - noVigProbability;
}

// Asian-handicap / total EV with push and half-win/half-loss outcomes.
// outcomes: array of { probability, payoutMultiplier } where payoutMultiplier is
// the return per unit staked for that outcome (e.g. win=odds-1, push=0, half-win=(odds-1)/2, loss=-1).
export function asianHandicapEV(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return null;
  if (Math.abs(outcomes.reduce((sum, o) => sum + o.probability, 0) - 1) > 1e-8) return null;
  let ev = 0;
  for (const o of outcomes) {
    if (!validProbability(o.probability) || !Number.isFinite(o.payoutMultiplier) || o.payoutMultiplier < -1) return null;
    ev += o.probability * o.payoutMultiplier;
  }
  return ev;
}

// Compute the full value picture for a single selection against Aposta odds.
export function computeValueSignal({ modelProbability, apostaOdds, selection, marketOdds, requiredSelections }) {
  if (!validProbability(modelProbability) || !validOdds(apostaOdds)) return null;
  const keys = requiredSelections || [];
  if (!keys.includes(selection) || keys.length < 2 || !keys.every((k) => validOdds(marketOdds?.[k]))) return null;
  const norm = noVigNormalize(keys.map((k) => impliedProbability(marketOdds[k])));
  const noVigProb = norm[keys.indexOf(selection)];
  return { modelProbability, apostaOdds, rawImpliedProbability: impliedProbability(apostaOdds),
    apostaNoVigProbability: noVigProb, probabilityEdge: probabilityEdge(modelProbability, noVigProb),
    expectedValue: simpleEV(modelProbability, apostaOdds), fairOdds: modelProbability > 0 ? 1 / modelProbability : null };
}

export function supportedMarket(key, line, period = "full_time") {
  return period === "full_time" && (["1x2", "btts"].includes(key) ||
    (key === "over_under_goals" && line === 2.5));
}

// Over/Under with push handling on integer lines.
export function computeOverUnderValue({ overProb, underProb, line, apostaOdds, apostaUnderOdds }) {
  if (line !== 2.5) return { blocked: true, reason: "UNSUPPORTED_INTEGER_OR_QUARTER_LINE" };
  const marketOdds = { over: apostaOdds, under: apostaUnderOdds };
  return Object.fromEntries([["over", overProb], ["under", underProb]].map(([selection, modelProbability]) =>
    [selection, computeValueSignal({ modelProbability, apostaOdds: marketOdds[selection], selection, marketOdds, requiredSelections: ["over", "under"] })]));
}

// Confidence score from measurable data-quality dimensions (0..1).
export function confidenceScore(dimensions) {
  // dimensions: { modelAgreement, calibrationQuality, featureCompleteness,
  //               oddsFreshness, mappingConfidence, lineupStatus, sampleSize, modelUncertainty }
  const weights = {
    modelAgreement: 0.15,
    calibrationQuality: 0.15,
    featureCompleteness: 0.15,
    oddsFreshness: 0.15,
    mappingConfidence: 0.15,
    lineupStatus: 0.1,
    sampleSize: 0.1,
    modelUncertainty: 0.05,
  };
  let score = 0;
  let totalW = 0;
  for (const [key, w] of Object.entries(weights)) {
    const v = dimensions[key];
    if (Number.isFinite(v)) {
      score += v * w;
      totalW += w;
    }
  }
  return totalW > 0 ? clampProbability(score / totalW) : 0;
}

export function confidenceLabel(score) {
  if (score == null || !Number.isFinite(score)) return "low";
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

// Recommendation status from EV, data quality and freshness.
export function recommendationStatus({ ev, dataQuality, oddsFresh, mappingConfident, sampleMet, marketOpen }) {
  if (!marketOpen) return "market_suspended";
  if (!oddsFresh) return "stale";
  if (!mappingConfident || !sampleMet) return "insufficient_data";
  if (ev == null || !Number.isFinite(ev)) return "insufficient_data";
  if (dataQuality === "poor" || dataQuality === "missing") return "insufficient_data";
  if (ev >= 0.08) return "strong_value";
  if (ev >= 0.03) return "value";
  if (ev >= 0) return "watch";
  return "no_value";
}

// Quality-adjusted EV: scale EV by a confidence factor so ranking reflects
// both edge and reliability. Never changes the underlying probability.
export function qualityAdjustedEV(ev, confidenceScoreVal) {
  if (!Number.isFinite(ev) || !Number.isFinite(confidenceScoreVal)) return ev;
  return ev * (0.5 + 0.5 * confidenceScoreVal);
}

export const VALUE_PROFILES = {
  conservative: { minEV: 0.05, minMapping: "high", minConfidence: "high" },
  balanced: { minEV: 0.03, minMapping: "high", minConfidence: "medium" },
  aggressive: { minEV: 0.015, minMapping: "medium", minConfidence: "medium" },
};

export function passesFilter(signal, profile) {
  const cfg = VALUE_PROFILES[profile] || VALUE_PROFILES.balanced;
  if (!signal) return false;
  if (signal.expectedValue == null || signal.expectedValue < cfg.minEV) return false;
  if (cfg.minMapping === "high" && (signal.mappingConfidence ?? 0) < 0.85) return false;
  if (cfg.minMapping === "medium" && (signal.mappingConfidence ?? 0) < 0.6) return false;
  const ranks = { low: 0, medium: 1, high: 2 };
  if ((ranks[signal.confidence] ?? -1) < ranks[cfg.minConfidence]) return false;
  return true;
}