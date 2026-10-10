// Shared signal filtering with provenance gate. Used by both the dashboard
// (listRecommendations) and the Edge Analyst AI to ensure they apply the
// same eligibility rules — no active recommendation is shown unless the full
// provenance chain is verified.
import { signalEligibility } from "@/lib/server/provenance.js";

const byId = (page) => Object.fromEntries((page.items || []).map((r) => [r.id, r]));

export async function filterEligibleSignals(base44, { limit = 50, minEV, userId = null, includeSuppressed = false } = {}) {
  // Load THIS user's EV threshold. Without a user id (or settings) the default
  // applies — never another user's settings row.
  let minEVValue = minEV;
  if (minEVValue == null) {
    const settingsPage = userId ? await base44.entities.UserSettings.filter({ created_by_id: userId }, { limit: 1 }) : { items: [] };
    const pct = Number(settingsPage.items?.[0]?.min_ev);
    minEVValue = (Number.isFinite(pct) && pct >= 0 ? pct : 3) / 100;
  }

  const page = await base44.entities.ValueSignal.filter(
    { is_active: true, status: { $in: ["value", "strong_value"] } },
    { sort: "-quality_adjusted_ev", limit }
  );
  const signals = page.items || [];
  if (signals.length === 0) return [];

  const ids = (field) => [...new Set(signals.map((s) => s[field]).filter(Boolean))];
  const [eventIds, predictionIds, selectionIds] = [ids("event_id"), ids("prediction_id"), ids("selection_id")];
  const [events, predictions, selections] = await Promise.all([
    eventIds.length ? base44.entities.Event.filter({ id: { $in: eventIds } }, { limit: 200 }).then(byId) : {},
    predictionIds.length ? base44.entities.Prediction.filter({ id: { $in: predictionIds } }, { limit: 200 }).then(byId) : {},
    selectionIds.length ? base44.entities.Selection.filter({ id: { $in: selectionIds } }, { limit: 200 }).then(byId) : {},
  ]);
  const modelVersionIds = [...new Set(Object.values(predictions).map((p) => p.model_version_id).filter(Boolean))];
  const modelVersions = modelVersionIds.length
    ? byId(await base44.entities.ModelVersion.filter({ id: { $in: modelVersionIds } }, { limit: 50 }))
    : {};

  const nowMs = Date.now();
  const gated = signals.map((s) => {
    const event = events[s.event_id];
    const prediction = predictions[s.prediction_id];
    const { eligible, reasons } = signalEligibility({
      signal: s, event, prediction, selection: selections[s.selection_id],
      modelVersion: prediction ? modelVersions[prediction.model_version_id] : null, minEV: minEVValue, nowMs,
    });
    return { ...s, event, eligible, suppression_reasons_now: reasons };
  });
  if (includeSuppressed) return gated;
  return gated.filter((s) => s.event && s.eligible).map(({ eligible, suppression_reasons_now, ...s }) => s);
}
