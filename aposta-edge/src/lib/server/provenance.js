// Provenance & data-integrity helpers. Pure functions, no secrets, no .server.js
// imports — safe to import from server functions and the client bundle alike.
//
// These rules gate which records may appear as active recommendations. They never
// alter a stored probability, odds snapshot or prediction; they only decide
// whether a record is *eligible for display* as a real Aposta-backed signal.

const ODDS_FRESH_MS = 30 * 60 * 1000; // 30 minutes
const MAPPING_SAFE_THRESHOLD = 0.85;

// A demo/test event: its Aposta id or URL betrays a sample payload.
export function isDemoEvent(event) {
  if (!event) return false;
  if (event.provenance === "demo") return true;
  const id = String(event.aposta_event_id || "");
  const url = String(event.aposta_event_url || "");
  return /^sample/i.test(id) || /\/sample-/i.test(url) || /\/sample$/i.test(url);
}

// An event has verifiable Aposta provenance when it carries a real Aposta id +
// URL and is not flagged demo.
export function hasVerifiableProvenance(event) {
  if (!event) return false;
  if (isDemoEvent(event)) return false;
  const id = String(event.aposta_event_id || "").trim();
  const url = String(event.aposta_event_url || "").trim();
  return id.length > 0 && id !== "unknown" && url.length > 0;
}

// Recompute odds freshness at read time — never trust a stored "fresh" label.
export function isOddsFresh(lastSyncAt, nowMs = Date.now(), maxAgeMs = ODDS_FRESH_MS) {
  if (!lastSyncAt) return false;
  const ts = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts < maxAgeMs;
}

// Kickoff has passed (event should be locked / no longer actionable).
export function kickoffPassed(event, nowMs = Date.now()) {
  if (!event?.kickoff_utc) return true; // unknown kickoff → treat as passed (unsafe)
  const ts = new Date(event.kickoff_utc).getTime();
  if (!Number.isFinite(ts)) return true;
  return ts < nowMs;
}

// Mapping is confident only when an external id exists AND confidence is high.
export function mappingConfident(event) {
  if (!event) return false;
  if (!event.external_event_id) return false;
  return (event.mapping_confidence ?? 0) >= MAPPING_SAFE_THRESHOLD;
}

// A prediction was actually computed by the pipeline (not hand-seeded) when it
// carries a feature_snapshot object. The pipeline always sets one; a seed row
// leaves it null.
export function predictionIsComputed(prediction) {
  if (!prediction) return false;
  return prediction.feature_snapshot != null && typeof prediction.feature_snapshot === "object";
}

// Full eligibility check for a value signal to appear as an ACTIVE recommendation.
// Returns { eligible, reasons[] } so callers can surface why a signal is suppressed.
export function signalEligibility({ signal, event, prediction, minEV = 0.03 }) {
  const reasons = [];
  if (!signal || !event) { return { eligible: false, reasons: ["missing_data"] }; }

  if (isDemoEvent(event)) reasons.push("demo_data");
  if (!hasVerifiableProvenance(event)) reasons.push("unverified_provenance");
  if (signal.is_active === false) reasons.push("inactive");
  if (event.is_locked) reasons.push("event_locked");
  if (kickoffPassed(event)) reasons.push("kickoff_passed");
  if (event.status === "postponed" || event.status === "cancelled" || event.status === "suspended") reasons.push("event_" + event.status);

  // EV threshold — the filter never changes the probability, only the gate.
  const ev = Number(signal.expected_value);
  if (!Number.isFinite(ev)) reasons.push("ev_not_computed");
  else if (ev < minEV) reasons.push("ev_below_threshold");

  // Odds freshness recomputed at read time.
  if (!isOddsFresh(event.last_odds_sync_at)) reasons.push("odds_stale");

  // Mapping must be backed by a real external id.
  if (!mappingConfident(event)) reasons.push("mapping_unconfirmed");

  // The prediction must have been computed, not seeded.
  if (!predictionIsComputed(prediction)) reasons.push("prediction_not_computed");

  return { eligible: reasons.length === 0, reasons };
}

// Describe a record's provenance for display.
export function describeProvenance(event) {
  if (!event) return { label: "—", source: "unknown", verified: false };
  if (isDemoEvent(event)) return { label: "DEMO DATA", source: "demo", verified: false };
  if (event.provenance === "manual_import") return { label: "Manual import", source: "manual_import", verified: hasVerifiableProvenance(event) };
  if (event.provenance === "aposta_api") return { label: "Aposta API", source: "aposta_api", verified: hasVerifiableProvenance(event) };
  if (hasVerifiableProvenance(event)) return { label: "Aposta (manual)", source: "manual_import", verified: true };
  return { label: "Unverified", source: "unknown", verified: false };
}