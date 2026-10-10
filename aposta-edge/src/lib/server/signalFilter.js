// Shared signal filtering with provenance gate. Used by both the dashboard
// (listRecommendations) and the Edge Analyst AI to ensure they apply the
// same eligibility rules — no active recommendation is shown unless the full
// provenance chain is verified.
import { signalEligibility } from "@/lib/server/provenance.js";

export async function filterEligibleSignals(base44, { limit = 50, minEV } = {}) {
  // Load the user's EV threshold so the filter reflects their profile.
  const settingsPage = await base44.entities.UserSettings.filter({}, { limit: 1 });
  const minEVValue = minEV ?? ((settingsPage.items?.[0]?.min_ev ?? 3) / 100);

  const page = await base44.entities.ValueSignal.filter(
    { is_active: true, status: { $in: ["value", "strong_value", "watch"] } },
    { sort: "-quality_adjusted_ev", limit }
  );
  const signals = page.items || [];
  if (signals.length === 0) return [];

  const eventIds = [...new Set(signals.map((s) => s.event_id))];
  const predictionIds = [...new Set(signals.map((s) => s.prediction_id).filter(Boolean))];
  const [eventsPage, predictionsPage] = await Promise.all([
    eventIds.length ? base44.entities.Event.filter({ id: { $in: eventIds } }, { limit: 100 }) : { items: [] },
    predictionIds.length ? base44.entities.Prediction.filter({ id: { $in: predictionIds } }, { limit: 100 }) : { items: [] },
  ]);
  const eventMap = {};
  for (const e of eventsPage.items || []) eventMap[e.id] = e;
  const predMap = {};
  for (const p of predictionsPage.items || []) predMap[p.id] = p;

  // Gate every signal through provenance + freshness + EV rules.
  return signals
    .map((s) => {
      const event = eventMap[s.event_id];
      const prediction = predMap[s.prediction_id];
      const { eligible, reasons } = signalEligibility({ signal: s, event, prediction, minEV: minEVValue });
      return { ...s, event, _suppressed: !eligible, _suppression_reasons: reasons };
    })
    .filter((s) => s.event && !s._suppressed)
    .map(({ _suppressed, _suppression_reasons, ...s }) => s);
}