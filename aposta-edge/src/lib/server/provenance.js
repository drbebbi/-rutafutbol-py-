// Provenance & data-integrity helpers. Pure functions, no secrets, no .server.js
// imports — safe to import from server functions and the client bundle alike.
//
// These rules gate which records may appear as active recommendations. They never
// alter a stored probability, odds snapshot or prediction; they only decide
// whether a record is *eligible for display* as a real Aposta-backed signal.

const ODDS_FRESH_MS = 30 * 60 * 1000; // 30 minutes
const MAPPING_SAFE_THRESHOLD = 0.85;
export const CLOCK_SKEW_MS = 5 * 60 * 1000; // tolerated provider/server clock skew

// A demo/test event: its Aposta id or URL betrays a sample payload.
export function isDemoEvent(event) {
  if (!event) return false;
  if (event.provenance === "demo") return true;
  const id = String(event.aposta_event_id || "");
  const url = String(event.aposta_event_url || "");
  return /^sample/i.test(id) || /\/sample-/i.test(url) || /\/sample$/i.test(url);
}

// Hosts accepted as an Aposta event URL.
const APOSTA_HOSTS = /^(www\.)?aposta\.la$/i;
export function isApostaUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" && APOSTA_HOSTS.test(u.hostname);
  } catch { return false; }
}

// An event has verifiable Aposta provenance when:
//   * it came from the configured Aposta API feed (provenance "aposta_api"), or
//   * it was imported manually AND an admin explicitly verified it against
//     aposta.la (source_verified_at + source_verified_by), AND
//   * in both cases it carries a real Aposta id and an https://aposta.la URL.
// A non-empty id + any URL is NOT evidence (anyone can type both).
export function hasVerifiableProvenance(event) {
  if (!event) return false;
  if (isDemoEvent(event)) return false;
  const id = String(event.aposta_event_id || "").trim();
  if (!id || id === "unknown" || !isApostaUrl(event.aposta_event_url)) return false;
  if (event.provenance === "aposta_api") return true;
  if (event.provenance === "manual_import") return !!event.source_verified_at && !!event.source_verified_by;
  return false;
}

// Recompute odds freshness at read time — never trust a stored "fresh" label.
export function isOddsFresh(lastSyncAt, nowMs = Date.now(), maxAgeMs = ODDS_FRESH_MS) {
  if (!lastSyncAt) return false;
  const ts = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(ts)) return false;
  // A timestamp in the future (beyond clock skew) is not evidence of freshness.
  if (ts - nowMs > CLOCK_SKEW_MS) return false;
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

// A prediction was actually computed from sufficient verified inputs. The
// pipeline sets computation_status = "computed" only when the feature
// validation passed; a seed row or an insufficient-data run never qualifies.
export function predictionIsComputed(prediction) {
  if (!prediction) return false;
  return prediction.computation_status === "computed" && prediction.feature_snapshot != null && typeof prediction.feature_snapshot === "object";
}

// Full eligibility check for a value signal to appear as an ACTIVE recommendation.
// Returns { eligible, reasons[] } so callers can surface why a signal is suppressed.
//   selection     — the CURRENT Selection row; the signal must have been computed
//                   from its current snapshot (otherwise the odds moved since).
//   modelVersion  — the ModelVersion of the prediction; only a model whose
//                   out-of-sample validation was recorded may recommend.
export function signalEligibility({ signal, event, prediction, selection, modelVersion, minEV = 0.03, nowMs = Date.now() }) {
  const reasons = [];
  if (!signal || !event) { return { eligible: false, reasons: ["missing_data"] }; }

  if (isDemoEvent(event)) reasons.push("demo_data");
  if (!hasVerifiableProvenance(event)) reasons.push("unverified_provenance");
  if (signal.is_active === false) reasons.push("inactive");
  if (event.is_locked) reasons.push("event_locked");
  if (kickoffPassed(event, nowMs)) reasons.push("kickoff_passed");
  if (event.status !== "scheduled") reasons.push("event_" + (event.status || "unknown"));
  if (Array.isArray(signal.suppression_reasons) && signal.suppression_reasons.length) reasons.push("signal_gated");
  if (!["value", "strong_value"].includes(signal.status)) reasons.push("status_" + (signal.status || "unknown"));

  // EV threshold — the filter never changes the probability, only the gate.
  const ev = Number(signal.expected_value);
  if (!Number.isFinite(ev)) reasons.push("ev_not_computed");
  else if (ev < minEV) reasons.push("ev_below_threshold");

  // Freshness of the odds the signal was computed from, recomputed now.
  if (!isOddsFresh(signal.odds_observed_at, nowMs)) reasons.push("odds_stale");

  // The signal must still describe the current price.
  if (!signal.odds_snapshot_id) reasons.push("odds_snapshot_unlinked");
  else if (!selection || selection.current_snapshot_id !== signal.odds_snapshot_id) reasons.push("odds_changed_since_calculation");

  // Mapping must be backed by a real external id.
  if (!mappingConfident(event)) reasons.push("mapping_unconfirmed");

  // The prediction must have been computed, not seeded, and still be current.
  if (!predictionIsComputed(prediction)) reasons.push("prediction_not_computed");
  else if (prediction.superseded_by) reasons.push("prediction_superseded");

  if (modelVersion?.validation_status !== "validated") reasons.push("model_not_validated");

  return { eligible: reasons.length === 0, reasons };
}

// Describe a record's provenance for display.
export function describeProvenance(event) {
  if (!event) return { label: "—", source: "unknown", verified: false };
  if (isDemoEvent(event)) return { label: "DEMO DATA", source: "demo", verified: false };
  if (event.provenance === "manual_import") {
    const verified = hasVerifiableProvenance(event);
    return { label: verified ? "Manual import (admin-verified)" : "Manual import (unverified)", source: "manual_import", verified };
  }
  if (event.provenance === "aposta_api") return { label: "Aposta API", source: "aposta_api", verified: hasVerifiableProvenance(event) };
  return { label: "Unverified", source: "unknown", verified: false };
}