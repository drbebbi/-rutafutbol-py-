// Loads everything known about one event, with every value signal gated
// (published + reasons) at read time. Shared by the event page, the in-app
// Edge Analyst and the analysis-package export, so all three see the same data.
import {
  isDemoEvent, hasVerifiableProvenance, isOddsFresh, kickoffPassed, mappingConfident,
  signalEligibility, describeProvenance, predictionIsComputed,
} from "./provenance.js";

export async function loadEventDetail(b, eventId) {
  const event = await b.entities.Event.get(eventId).catch(() => null);
  if (!event) return null;
  const [markets, predictions, injuries, lineups, stats, snapshots] = await Promise.all([
    b.entities.Market.filter({ event_id: eventId }, { limit: 50 }),
    b.entities.Prediction.filter({ event_id: eventId }, { limit: 10, sort: "-version" }),
    b.entities.Injury.filter({ event_id: eventId }, { limit: 20 }),
    b.entities.Lineup.filter({ event_id: eventId }, { limit: 2 }),
    b.entities.TeamMatchStat.filter({ event_id: eventId }, { limit: 20 }),
    b.entities.OddsSnapshot.filter({ event_id: eventId }, { limit: 100, sort: "-retrieval_timestamp" }),
  ]);
  const marketIds = (markets.items || []).map((m) => m.id);
  const selections = marketIds.length
    ? await b.entities.Selection.filter({ market_id: { $in: marketIds } }, { limit: 200 })
    : { items: [] };
  const signals = await b.entities.ValueSignal.filter({ event_id: eventId, is_active: true }, { limit: 30 });
  const now = Date.now();
  const pred = (predictions.items || [])[0];
  const modelVersion = pred?.model_version_id ? await b.entities.ModelVersion.get(pred.model_version_id).catch(() => null) : null;
  const selById = Object.fromEntries((selections.items || []).map((s) => [s.id, s]));
  // Every signal carries the reasons it is (not) published, recomputed now.
  const enrichedSignals = (signals.items || []).map((s) => {
    const gate = signalEligibility({ signal: s, event, prediction: pred, selection: selById[s.selection_id], modelVersion, nowMs: now });
    return { ...s, odds_fresh: isOddsFresh(s.odds_observed_at, now), published: gate.eligible, gate_reasons: gate.reasons };
  });
  return {
    event,
    provenance: describeProvenance(event),
    // Fresh only if every current price has a recent SOURCE observation time.
    odds_fresh: (selections.items || []).length > 0 && (selections.items || []).every((sel) => isOddsFresh(sel.odds_observed_at, now)),
    kickoff_passed: kickoffPassed(event, now),
    mapping_confident: mappingConfident(event),
    is_demo: isDemoEvent(event),
    verifiable: hasVerifiableProvenance(event),
    prediction_computed: predictionIsComputed(pred),
    model_version: modelVersion ? { label: modelVersion.version_label, validation_status: modelVersion.validation_status || "unvalidated", calibration_method: modelVersion.calibration_method } : null,
    markets: markets.items || [],
    selections: selections.items || [],
    predictions: predictions.items || [],
    injuries: injuries.items || [],
    lineups: lineups.items || [],
    stats: stats.items || [],
    snapshots: snapshots.items || [],
    signals: enrichedSignals,
  };
}
