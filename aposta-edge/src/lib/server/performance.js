// Performance read model: 1X2 forecast quality and the settled recommendation
// ledger (published vs. shadow). Shared by the metrics job, the performance
// page and the Edge Analyst. Definitions live in ../metrics.js.
import { forecastSummary, bettingSummary } from "../metrics.js";

export async function computePerformance(base44) {
  const outcomes = await fetchAll(base44.entities.PredictionOutcome, { market_key: "1x2" });
  const byPrediction = new Map();
  for (const o of outcomes) {
    if (!["win", "loss"].includes(o.result)) continue;
    const row = byPrediction.get(o.prediction_id) || { probs: {}, outcome: null };
    row.probs[o.selection] = o.predicted_probability;
    if (o.result === "win") row.outcome = o.selection;
    byPrediction.set(o.prediction_id, row);
  }
  const forecasts = [...byPrediction.values()].filter((r) => r.outcome && Object.keys(r.probs).length === 3);
  const recs = await fetchAll(base44.entities.Recommendation, {});
  const settled = recs.filter((r) => ["win", "loss", "push", "void"].includes(r.settlement_status))
    .map((r) => ({ odds: r.aposta_odds, result: r.settlement_status, settled_at: r.settled_at, closing_no_vig_probability: r.closing_no_vig_probability, published: r.published, market_key: r.market_key }));
  const byMarket = {};
  for (const b of settled.filter((x) => x.published)) (byMarket[b.market_key] ??= []).push(b);
  return {
    forecast_1x2: forecastSummary(forecasts),
    published: bettingSummary(settled.filter((b) => b.published)),
    shadow: bettingSummary(settled.filter((b) => !b.published)),
    published_by_market: Object.fromEntries(Object.entries(byMarket).map(([k, v]) => [k, bettingSummary(v)])),
    pending_recommendations: recs.filter((r) => r.settlement_status === "pending").length,
  };
}

async function fetchAll(entity, query, pageSize = 500, max = 20000) {
  const out = [];
  for (let skip = 0; skip < max; skip += pageSize) {
    const page = await entity.filter(query, { limit: pageSize, skip, sort: "created_date" });
    const items = page.items || [];
    out.push(...items);
    if (items.length < pageSize || page.has_more === false) break;
  }
  return out;
}

