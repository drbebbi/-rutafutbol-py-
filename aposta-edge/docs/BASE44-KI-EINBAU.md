# Edge Analyst KI – Einbau in Base44

Die KI besteht aus **10 Dateien**: 5 neue Dateien und 5 Dateien, die ersetzt werden.
Sie funktionieren auch in deinem ursprünglichen Base44-Projekt (getestet: alle Importe lösen sich auf).

## Weg A – Code-Editor in Base44 (am sichersten)
Öffne im Base44-Projekt den Code-Bereich und gehe die Dateien in der Reihenfolge unten durch:
- **NEU** → Datei mit genau diesem Pfad anlegen, Code einfügen.
- **ERSETZEN** → gesamten Inhalt der Datei löschen, Code einfügen.
Danach speichern bzw. veröffentlichen.

## Weg B – über den Base44-KI-Chat
Schicke dem Base44-Chat **eine Nachricht pro Datei**, in der Reihenfolge unten. Jede Nachricht ist fertig formuliert: alles zwischen „NACHRICHT ANFANG“ und „NACHRICHT ENDE“ kopieren.
Wichtig: Danach kontrollieren, dass Base44 den Code **nicht gekürzt oder umgeschrieben** hat (die Zeilenzahl steht bei jeder Datei).

## Nach dem Einbau testen
1. In der App auf **Edge AI** gehen und fragen: `¿Qué recomendaciones hay hoy?`
2. Erwartete Antwort (solange das Modell nicht validiert ist): Hinweis, dass das Modell nicht validiert ist, und „Hoy no hay recomendaciones publicadas“. **Das ist korrekt**, kein Fehler.
3. Auf einer Spielseite die Knöpfe **„Copiar paquete para IA“** und **„Copiar prompt“** prüfen.

## Wichtig zu wissen
- Mit der **alten** Datenpipeline haben gespeicherte Prognosen kein Feld `computation_status`. Die KI meldet dann „sin pronóstico“, weil die alten Prognosen für jedes Spiel identisch und damit falsch waren (siehe AUDIT.md, F01). Für echte Prognosen das komplette korrigierte Projekt übernehmen (`aposta-edge-korrigiert.zip`).
- Die KI empfiehlt nur Wetten, die die App freigegeben hat, antwortet auf Spanisch und rechnet immer mit 1 Einheit Einsatz.

## Reihenfolge
1. `src/lib/metrics.js` – NEU (127 Zeilen)
2. `src/lib/server/performance.js` – NEU (41 Zeilen)
3. `src/lib/server/provenance.js` – ERSETZEN (131 Zeilen)
4. `src/lib/server/signalFilter.js` – ERSETZEN (50 Zeilen)
5. `src/lib/server/eventDetail.js` – NEU (54 Zeilen)
6. `src/lib/analysisPackage.js` – NEU (111 Zeilen)
7. `src/lib/analystPrompts.js` – NEU (67 Zeilen)
8. `src/lib/edgeAiChat.js` – ERSETZEN (91 Zeilen)
9. `src/routes/_authed/event.$eventId.jsx` – ERSETZEN (234 Zeilen)
10. `base44/agents/edge-analyst.jsonc` – ERSETZEN (66 Zeilen)

---

## 1/10 · `src/lib/metrics.js` · NEU · 127 Zeilen

**NACHRICHT ANFANG**

Lege eine NEUE Datei mit dem Pfad `src/lib/metrics.js` an und füge exakt diesen Code ein. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 127 Zeilen haben.

```javascript
// Settlement and evaluation metrics. Pure — used by the pipeline, the
// performance page and the backtest so every number has ONE definition.
//
// Definitions (flat staking, 1 unit per bet):
//   profit_units  = Σ (odds − 1) for wins, −1 for losses, 0 for push/void
//   staked_units  = number of bets with a stake that was not voided
//   yield         = profit_units / staked_units   (a.k.a. ROI on turnover)
//   roi           = identical to yield under flat 1-unit staking; it is kept
//                   only as an alias so no screen can show a different number.
//   max_drawdown  = largest peak-to-trough fall of the cumulative profit curve
//                   (in units), in chronological order of settlement.
//   clv           = taken_odds × closing_no_vig_probability − 1
//                   (EV of the taken price measured at the closing fair price).

const EPS = 1e-15;

export function outcome1x2(home, away) {
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return null;
  return home > away ? "home" : home === away ? "draw" : "away";
}

// Settle one selection of a supported market. Returns win | loss | push | void,
// or null when the score is not a confirmed integer result.
export function settleSelection({ market_key, selection, line = null }, home, away) {
  const r = outcome1x2(home, away);
  if (r == null) return null;
  if (market_key === "1x2") return ["home", "draw", "away"].includes(selection) ? (selection === r ? "win" : "loss") : "void";
  if (market_key === "btts") {
    const yes = home > 0 && away > 0;
    if (selection === "yes") return yes ? "win" : "loss";
    if (selection === "no") return yes ? "loss" : "win";
    return "void";
  }
  if (market_key === "over_under_goals") {
    if (!Number.isFinite(line) || Math.round(line * 4) !== line * 4 || (line * 4) % 2 !== 0) return "void"; // quarter lines unsupported
    const total = home + away;
    if (total === line) return "push";
    if (selection === "over") return total > line ? "win" : "loss";
    if (selection === "under") return total < line ? "win" : "loss";
    return "void";
  }
  return "void";
}

export function profitUnits(result, odds) {
  if (result === "win") return Number.isFinite(odds) && odds > 1 ? odds - 1 : null;
  if (result === "loss") return -1;
  if (result === "push" || result === "void") return 0;
  return null;
}

// bets: [{ odds, result, settled_at?, closing_no_vig_probability? }]
export function bettingSummary(bets) {
  const ordered = [...(bets || [])].filter((b) => ["win", "loss", "push", "void"].includes(b.result))
    .sort((a, b) => String(a.settled_at || "").localeCompare(String(b.settled_at || "")));
  let profit = 0, staked = 0, wins = 0, losses = 0, pushes = 0, peak = 0, maxDd = 0, oddsSum = 0;
  const clvs = [];
  for (const b of ordered) {
    const p = profitUnits(b.result, b.odds);
    if (p == null) continue;
    if (b.result !== "void") { staked += 1; oddsSum += b.odds; }
    if (b.result === "win") wins++; else if (b.result === "loss") losses++; else if (b.result === "push") pushes++;
    profit += p;
    peak = Math.max(peak, profit);
    maxDd = Math.max(maxDd, peak - profit);
    if (Number.isFinite(b.closing_no_vig_probability) && Number.isFinite(b.odds)) clvs.push(b.odds * b.closing_no_vig_probability - 1);
  }
  const yieldValue = staked > 0 ? profit / staked : null;
  return {
    bets: staked, wins, losses, pushes,
    staked_units: staked, profit_units: profit,
    yield: yieldValue, roi: yieldValue,
    hit_rate: wins + losses > 0 ? wins / (wins + losses) : null,
    max_drawdown_units: maxDd,
    avg_odds: staked > 0 ? oddsSum / staked : null,
    avg_clv: clvs.length ? clvs.reduce((a, c) => a + c, 0) / clvs.length : null,
    clv_sample_size: clvs.length,
  };
}

// Multiclass scoring for one categorical forecast.
// probs: { home, draw, away } (or any keys), outcome: one of the keys.
export function logLoss(probs, outcome) {
  const p = probs?.[outcome];
  if (!Number.isFinite(p)) return null;
  return -Math.log(Math.max(p, EPS));
}

export function brierScore(probs, outcome) {
  if (!probs || !(outcome in probs)) return null;
  let s = 0;
  for (const [k, p] of Object.entries(probs)) s += (p - (k === outcome ? 1 : 0)) ** 2;
  return s;
}

// forecasts: [{ probs, outcome }] — one row per MATCH (not per selection).
export function forecastSummary(forecasts) {
  const rows = (forecasts || []).filter((f) => f.probs && f.outcome && Number.isFinite(f.probs[f.outcome]));
  const n = rows.length;
  if (n === 0) return { sample_size: 0, log_loss: null, brier_score: null, accuracy: null };
  let ll = 0, bs = 0, hits = 0;
  for (const f of rows) {
    ll += logLoss(f.probs, f.outcome);
    bs += brierScore(f.probs, f.outcome);
    const argmax = Object.entries(f.probs).sort((a, b) => b[1] - a[1])[0][0];
    if (argmax === f.outcome) hits++;
  }
  return { sample_size: n, log_loss: ll / n, brier_score: bs / n, accuracy: hits / n };
}

// Reliability diagram data. pairs: [{ p, y }] with y ∈ {0,1}.
export function calibrationBins(pairs, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ lower: i / bins, upper: (i + 1) / bins, n: 0, mean_p: null, observed: null, _sp: 0, _sy: 0 }));
  for (const { p, y } of pairs || []) {
    if (!Number.isFinite(p) || p < 0 || p > 1 || (y !== 0 && y !== 1)) continue;
    const b = out[Math.min(bins - 1, Math.floor(p * bins))];
    b.n++; b._sp += p; b._sy += y;
  }
  return out.map(({ _sp, _sy, ...b }) => ({ ...b, mean_p: b.n ? _sp / b.n : null, observed: b.n ? _sy / b.n : null }));
}

// Expected calibration error (weighted by bin size).
export function expectedCalibrationError(bins) {
  const total = bins.reduce((a, b) => a + b.n, 0);
  if (!total) return null;
  return bins.reduce((a, b) => a + (b.n ? (b.n / total) * Math.abs(b.mean_p - b.observed) : 0), 0);
}
```

**NACHRICHT ENDE**

---

## 2/10 · `src/lib/server/performance.js` · NEU · 41 Zeilen

**NACHRICHT ANFANG**

Lege eine NEUE Datei mit dem Pfad `src/lib/server/performance.js` an und füge exakt diesen Code ein. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 41 Zeilen haben.

```javascript
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

```

**NACHRICHT ENDE**

---

## 3/10 · `src/lib/server/provenance.js` · ERSETZEN · 131 Zeilen

**NACHRICHT ANFANG**

Ersetze den GESAMTEN Inhalt der Datei `src/lib/server/provenance.js` exakt durch diesen Code. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 131 Zeilen haben.

```javascript
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
}```

**NACHRICHT ENDE**

---

## 4/10 · `src/lib/server/signalFilter.js` · ERSETZEN · 50 Zeilen

**NACHRICHT ANFANG**

Ersetze den GESAMTEN Inhalt der Datei `src/lib/server/signalFilter.js` exakt durch diesen Code. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 50 Zeilen haben.

```javascript
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
```

**NACHRICHT ENDE**

---

## 5/10 · `src/lib/server/eventDetail.js` · NEU · 54 Zeilen

**NACHRICHT ANFANG**

Lege eine NEUE Datei mit dem Pfad `src/lib/server/eventDetail.js` an und füge exakt diesen Code ein. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 54 Zeilen haben.

```javascript
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
```

**NACHRICHT ENDE**

---

## 6/10 · `src/lib/analysisPackage.js` · NEU · 111 Zeilen

**NACHRICHT ANFANG**

Lege eine NEUE Datei mit dem Pfad `src/lib/analysisPackage.js` an und füge exakt diesen Code ein. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 111 Zeilen haben.

```javascript
// Builds the "analysis package": the ONLY data an AI analyst may use for one
// match. Pure — used by the in-app Edge Analyst tool and by the "copy package
// for AI" button, so both AIs see byte-identical facts.
//
// Contents are limited to stored, timestamped facts: Aposta prices with their
// source observation time and snapshot id, the model's probabilities and ±1 SE
// band, data-quality dimensions, and the publication gate with its reasons.
// Nothing here is estimated by the package itself.

export const PACKAGE_SCHEMA = "aposta-edge.analysis-package/1";

const MARKET_ORDER = [
  { market_key: "1x2", line: null, probKey: "1x2", selections: ["home", "draw", "away"] },
  { market_key: "over_under_goals", line: 2.5, probKey: "over_under_goals:2.5", selections: ["over", "under"] },
  { market_key: "btts", line: null, probKey: "btts", selections: ["yes", "no"] },
];

const round = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export function buildAnalysisPackage(detail, generatedAt = new Date().toISOString()) {
  if (!detail?.event) return null;
  const { event, markets = [], selections = [], predictions = [], signals = [], lineups = [], injuries = [] } = detail;
  const prediction = predictions[0] || null;
  const computed = prediction?.computation_status === "computed";

  const signalFor = (marketKey, line, sel) => signals.find((s) => s.market_key === marketKey && (s.line ?? null) === line && s.selection === sel) || null;

  const marketBlocks = MARKET_ORDER.map((spec) => {
    const market = markets.find((m) => m.market_key === spec.market_key && (m.line ?? null) === spec.line && (m.period || "full_time") === "full_time");
    if (!market) return { market_key: spec.market_key, line: spec.line, available: false };
    const probs = computed ? prediction.market_probabilities?.[spec.probKey] : null;
    const bands = computed ? prediction.probability_intervals?.[spec.probKey] : null;
    return {
      market_key: spec.market_key,
      line: spec.line,
      available: true,
      market_status: market.status || "unknown",
      selections: spec.selections.map((sel) => {
        const row = selections.find((s) => s.market_id === market.id && s.selection === sel);
        const sig = signalFor(spec.market_key, spec.line, sel);
        return {
          selection: sel,
          aposta_odds: row?.current_odds ?? null,
          opening_odds: row?.opening_odds ?? null,
          selection_status: row?.status || "unknown",
          odds_observed_at: row?.odds_observed_at || null,
          odds_snapshot_id: row?.current_snapshot_id || null,
          model_probability: round(probs?.[sel]),
          model_probability_1se: bands?.[sel] ? bands[sel].map((v) => round(v)) : null,
          no_vig_probability: round(sig?.aposta_no_vig_probability),
          fair_odds: round(sig?.fair_odds, 3),
          expected_value: round(sig?.expected_value),
          expected_value_lower_1se: round(sig?.ev_lower),
          signal_status: sig?.status || null,
          published: sig ? sig.published === true : false,
          not_published_reasons: sig ? (sig.published ? [] : sig.gate_reasons || sig.suppression_reasons || []) : ["no_signal_calculated"],
        };
      }),
      bookmaker_margin: round(signals.find((s) => s.market_key === spec.market_key && (s.line ?? null) === spec.line)?.bookmaker_margin),
    };
  });

  return {
    schema: PACKAGE_SCHEMA,
    generated_at: generatedAt,
    stake_rule: "flat_1_unit",
    event: {
      id: event.id,
      home_team: event.home_team_name,
      away_team: event.away_team_name,
      competition: event.competition_name || null,
      kickoff_utc: event.kickoff_utc || null,
      kickoff_history: event.kickoff_history || [],
      status: event.status,
      kickoff_passed: !!detail.kickoff_passed,
      aposta_event_id: event.aposta_event_id || null,
      aposta_event_url: event.aposta_event_url || null,
    },
    source: {
      provenance: detail.provenance?.source || "unknown",
      provenance_verified: !!detail.verifiable,
      is_demo: !!detail.is_demo,
      mapping_confident: !!detail.mapping_confident,
      all_odds_fresh: !!detail.odds_fresh,
    },
    model: {
      version: detail.model_version?.label || null,
      validation_status: detail.model_version?.validation_status || "unvalidated",
      calibration: detail.model_version?.calibration_method || "none",
      method: "independent Poisson on recent-form features (Elo only when fitted); rho = 0",
    },
    prediction: prediction ? {
      computation_status: prediction.computation_status || "unknown",
      insufficient_reasons: prediction.insufficient_reasons || [],
      predicted_at: prediction.predicted_at || null,
      version: prediction.version ?? null,
      expected_goals_home: computed ? round(prediction.lambda_home, 3) : null,
      expected_goals_away: computed ? round(prediction.lambda_away, 3) : null,
      sample_size_home: prediction.feature_snapshot?.home?.sample_size ?? 0,
      sample_size_away: prediction.feature_snapshot?.away?.sample_size ?? 0,
      form_home: computed ? { avg_goals: round(prediction.feature_snapshot.home.avg_goals, 3), avg_conceded: round(prediction.feature_snapshot.home.avg_goals_conceded, 3) } : null,
      form_away: computed ? { avg_goals: round(prediction.feature_snapshot.away.avg_goals, 3), avg_conceded: round(prediction.feature_snapshot.away.avg_goals_conceded, 3) } : null,
      data_quality: prediction.data_quality || null,
      top_scores: computed ? (prediction.score_distribution || []).slice(0, 5).map((s) => ({ score: s.score, probability: round(s.prob) })) : [],
    } : { computation_status: "missing", insufficient_reasons: ["no_prediction"] },
    markets: marketBlocks,
    lineups: lineups.map((l) => ({ side: l.is_home ? "home" : "away", status: l.status, formation: l.formation || null })),
    injuries: injuries.map((i) => ({ team: i.team_id === event.home_team_id ? "home" : i.team_id === event.away_team_id ? "away" : "unknown", player: i.player_name, status: i.status })),
    injuries_in_model: false,
  };
}
```

**NACHRICHT ENDE**

---

## 7/10 · `src/lib/analystPrompts.js` · NEU · 67 Zeilen

**NACHRICHT ANFANG**

Lege eine NEUE Datei mit dem Pfad `src/lib/analystPrompts.js` an und füge exakt diesen Code ein. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 67 Zeilen haben.

```javascript
// System prompts for the Edge Analyst. Two variants share the same rules:
//   APP_SYSTEM_PROMPT        — in-app analyst; data only via tools.
//   STANDALONE_SYSTEM_PROMPT — for an external chat (Claude/ChatGPT); data only
//                              via the pasted analysis package (analysisPackage.js).
// Answers are in Spanish (users in Paraguay). Stakes: flat 1 unit, always.

const CORE_RULES = `
## Tu papel
Eres "Edge Analyst", analista cuantitativo de apuestas de fútbol de Aposta Edge AI para usuarios en Paraguay.
Explicas lo que el modelo estadístico de la plataforma calculó a partir de las cuotas de Aposta.la. No eres un tipster: no adivinas, no prometes ganancias y no inventas datos.

## Reglas absolutas
1. FUENTE ÚNICA. Solo usas los datos que te entrega la plataforma (herramientas o paquete de análisis). Nunca inventes ni completes partidos, cuotas, probabilidades, alineaciones, lesiones, resultados ni estadísticas. Si un dato falta, di exactamente cuál falta.
2. SIN PROBABILIDADES PROPIAS. Todas las probabilidades vienen del modelo (Poisson independiente sobre la forma reciente; Elo solo si está ajustado; sin corrección Dixon-Coles todavía). No las corrijas "a ojo" por intuición, noticias, nombre del club o rachas.
3. CUOTAS SOLO DE APOSTA. Las cuotas son las de Aposta.la con su hora de observación (odds_observed_at). Nunca uses cuotas de otras casas ni de tu memoria.
4. PUBLICADO = RECOMENDABLE. Solo una selección con published = true es una recomendación. Cualquier otra, aunque su EV sea positivo, NO es recomendación: dilo y explica los motivos (not_published_reasons) en lenguaje sencillo.
5. SIN DATOS SUFICIENTES = SIN PRONÓSTICO. Si computation_status no es "computed", no hay pronóstico: explica los motivos (insufficient_reasons) y qué datos faltan. No ofrezcas una "opinión" alternativa.
6. MODELO NO VALIDADO. Si validation_status no es "validated", dilo siempre al principio: el modelo aún no tiene validación fuera de muestra y sus valores son orientativos; no hay recomendaciones publicadas.
7. TIEMPO. Si el partido ya empezó (kickoff_passed), está aplazado/cancelado, o las cuotas no son recientes (más de 30 minutos desde odds_observed_at, o sin hora), no hay recomendación pre-partido.
8. STAKE FIJO. Toda recomendación publicada se expresa con 1 unidad de stake. Nunca sugieras aumentar el stake, recuperar pérdidas, combinadas ("parlays") ni porcentajes de banca.
9. SIN GARANTÍAS. Un EV positivo no es una ganancia segura. No uses frases como "seguro", "fijo", "no puede fallar", "dinero fácil".
10. JUEGO RESPONSABLE. Si el usuario muestra señales de problema (perseguir pérdidas, apostar dinero necesario, angustia), deja de analizar apuestas, responde con empatía y sugiere pausar y buscar ayuda. Solo mayores de 18 años.

## Cómo se calcula (para explicarlo, no para recalcular a tu manera)
- Probabilidad implícita = 1 / cuota.  Margen de la casa = suma de implícitas del mercado − 1.
- Probabilidad sin margen (no-vig) = implícita / suma de implícitas.
- Cuota justa del modelo = 1 / probabilidad del modelo.
- Valor esperado (EV) por 1 unidad = probabilidad del modelo × cuota − 1.  Ventaja = probabilidad del modelo − probabilidad sin margen.
- La banda ±1 SE (model_probability_1se) refleja solo la incertidumbre por tamaño de muestra. Si el extremo inferior da EV negativo (expected_value_lower_1se < 0), el valor es frágil: dilo.
- Puedes verificar la aritmética con los números entregados. Si tu verificación difiere del valor entregado en más de 0,5 puntos porcentuales, señálalo como inconsistencia y no recomiendes.

## Mercados del MVP
Solo 1X2, Más/Menos 2,5 goles y Ambos marcan (BTTS), tiempo reglamentario. Otros mercados (hándicap asiático, doble oportunidad, marcador exacto, etc.): responde que aún no están soportados.

## Formato de respuesta (español, conciso, con viñetas)
**Partido:** Local vs Visitante · competición · hora de inicio (hora de Paraguay, America/Asuncion)
**Estado de los datos:** fuente (verificada o no) · cuotas observadas a las HH:MM · modelo (versión, validado o no) · muestra (partidos local/visitante)
**Pronóstico del modelo:** 1X2 · Más/Menos 2,5 · BTTS en %, con goles esperados
**Mercados:** por selección → cuota Aposta · prob. modelo (banda ±1 SE) · prob. sin margen · EV · estado
**Veredicto:** una de estas tres, textual:
  - "✅ Recomendación publicada: <selección> @ <cuota>, stake 1 unidad, EV +x,x %"
  - "➖ Sin valor" (EV ≤ 0 o por debajo del umbral)
  - "⚠️ Sin recomendación: <motivo principal>"
**Riesgos e incertidumbre:** 2–4 puntos concretos (muestra pequeña, modelo no calibrado, lesiones no incluidas en el modelo, cuota que se movió, etc.)
**Datos que faltan:** lista breve, o "ninguno relevante"
Termina siempre con: "Análisis estadístico, no asesoramiento financiero. Apuesta con responsabilidad (+18)."
`;

export const APP_SYSTEM_PROMPT = `${CORE_RULES}
## Herramientas (úsalas SIEMPRE antes de hablar de un partido o mercado concreto)
- listTopValueSignals: solo recomendaciones publicadas (ya pasaron todos los filtros).
- searchEvents: buscar partidos por nombre de equipo para obtener su id.
- getEventAnalysis: paquete de análisis completo de un partido (el mismo que se exporta para IA externa).
- getPerformanceMetrics: calidad del pronóstico (log loss, Brier, acierto) y balance de apuestas (unidades, yield, drawdown, CLV) publicado y en sombra.
- getProviderHealth: estado de las fuentes de datos.
Si una herramienta devuelve vacío o error, dilo claramente y no especules. Si te preguntan algo que ninguna herramienta responde, di que no puedes ayudar con eso.
Si listTopValueSignals no devuelve nada, la respuesta correcta es: "Hoy no hay recomendaciones publicadas" y, si procede, el motivo general (p. ej. modelo no validado).
Al hablar de rendimiento: con menos de 300 apuestas liquidadas, advierte que el resultado está dominado por la varianza; diferencia siempre "publicado" de "en sombra".`;

export const STANDALONE_SYSTEM_PROMPT = `${CORE_RULES}
## Entrada
Recibirás uno o varios "paquetes de análisis" en JSON con schema "aposta-edge.analysis-package/1", exportados desde la app Aposta Edge AI (botón "Copiar paquete para IA"). Es tu ÚNICA fuente de datos.
- Si el usuario no pega un paquete, pídeselo y no analices nada.
- Si el JSON está incompleto, tiene otro schema o fue editado (p. ej. probabilidades que no suman ~100 %, cuotas ≤ 1), dilo y no recomiendes.
- La vigencia de las cuotas se juzga respecto a generated_at del paquete Y a la hora actual que indique el usuario; si no sabes la hora actual, advierte que las cuotas pueden haber cambiado y que debe exportar un paquete nuevo antes de apostar.
- No busques información en internet ni uses conocimientos previos sobre los equipos para cambiar números. Puedes mencionar contexto general solo si el usuario lo pide, marcándolo como "no incluido en el modelo".
- Respeta el campo published del paquete: tú no puedes publicar ni "despublicar" una selección.`;
```

**NACHRICHT ENDE**

---

## 8/10 · `src/lib/edgeAiChat.js` · ERSETZEN · 91 Zeilen

**NACHRICHT ANFANG**

Ersetze den GESAMTEN Inhalt der Datei `src/lib/edgeAiChat.js` exakt durch diesen Code. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 91 Zeilen haben.

```javascript
// Edge Analyst AI — a code agent on the Base44 AI gateway.
// Strict rule: the model may ONLY answer from data returned by its tools.
// It must NEVER invent games, odds, probabilities or recommendations.
import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { APP_SYSTEM_PROMPT } from "@/lib/analystPrompts.js";

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const chatWithEdgeAnalyst = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ messages: z.array(z.any()).max(40) }))
  .handler(async ({ data, context }) => {
    const { gatewayModel } = await import("@/lib/ai.server");
    const base44 = context.getBase44();

    const listTopValueSignals = toolDefinition({
      name: "listTopValueSignals",
      description: "List the current top value signals (active, ranked by quality-adjusted expected value). Use this when the user asks for today's best bets, value picks, or top opportunities. Only signals with verified Aposta provenance, confirmed fixture mapping, and computed predictions are returned — no speculative tips.",
      inputSchema: z.object({ limit: z.number().min(1).max(20).default(10) }),
    }).server(async ({ limit }) => {
      // Same provenance gate as the dashboard — no active recommendations
      // unless the full chain is verified.
      const { filterEligibleSignals } = await import("@/lib/server/signalFilter.js");
      const signals = await filterEligibleSignals(base44, { limit, userId: context.user.id });
      return signals.map((s) => ({
        event: s.event ? `${s.event.home_team_name} vs ${s.event.away_team_name}` : null,
        kickoff: s.event?.kickoff_utc || null,
        market: s.market_key, selection: s.selection, line: s.line,
        aposta_odds: s.aposta_odds, model_probability: s.model_probability,
        expected_value: s.expected_value, probability_edge: s.probability_edge,
        status: s.status, confidence: s.confidence, data_quality: s.data_quality,
        published: true, stake_units: 1, odds_observed_at: s.odds_observed_at,
      }));
    });

    const getEventAnalysis = toolDefinition({
      name: "getEventAnalysis",
      description: "Get the analysis package for one match (schema aposta-edge.analysis-package/1): Aposta odds with observation time, model probabilities with ±1 SE band, EV, data quality, and for every selection whether it is published and why not. Use this whenever the user asks about a specific match.",
      inputSchema: z.object({ event_id: z.string() }),
    }).server(async ({ event_id }) => {
      const [{ loadEventDetail }, { buildAnalysisPackage }] = await Promise.all([
        import("@/lib/server/eventDetail.js"), import("@/lib/analysisPackage.js"),
      ]);
      const detail = await loadEventDetail(base44, event_id);
      if (!detail) return { error: "Event not found" };
      return buildAnalysisPackage(detail);
    });

    const searchEvents = toolDefinition({
      name: "searchEvents",
      description: "Search scheduled events by team name (substring match). Returns upcoming events with ids so the user can ask for full analysis next.",
      inputSchema: z.object({ team: z.string().max(60) }),
    }).server(async ({ team }) => {
      const page = await base44.entities.Event.filter(
        { $or: [{ home_team_name: { $regex: escapeRegex(team), $options: "i" } }, { away_team_name: { $regex: escapeRegex(team), $options: "i" } }] },
        { sort: "kickoff_utc", limit: 15 }
      );
      return (page.items || []).map((e) => ({
        id: e.id, home: e.home_team_name, away: e.away_team_name,
        kickoff: e.kickoff_utc, competition: e.competition_name, status: e.status,
      }));
    });

    const getPerformanceMetrics = toolDefinition({
      name: "getPerformanceMetrics",
      description: "Get the model's forecast quality (multiclass log loss, Brier, accuracy) and the settled betting record (profit units, yield, drawdown, CLV) for published and shadow recommendations.",
      inputSchema: z.object({}),
    }).server(async () => {
      const { computePerformance } = await import("@/lib/server/performance.js");
      return computePerformance(base44);
    });

    const getProviderHealth = toolDefinition({
      name: "getProviderHealth",
      description: "Check the connection status of data providers (Aposta, football data API). Use when the user asks why data is missing or if providers are connected.",
      inputSchema: z.object({}),
    }).server(async () => {
      const page = await base44.entities.ProviderHealth.filter({}, { limit: 20 });
      return (page.items || []).map((p) => ({ provider: p.provider, status: p.status, error: p.error_message, latency_ms: p.latency_ms }));
    });

    return chat({
      adapter: gatewayModel(base44),
      messages: data.messages,
      systemPrompts: [APP_SYSTEM_PROMPT],
      tools: [listTopValueSignals, getEventAnalysis, searchEvents, getPerformanceMetrics, getProviderHealth],
      agentLoopStrategy: maxIterations(5),
    });
  });```

**NACHRICHT ENDE**

---

## 9/10 · `src/routes/_authed/event.$eventId.jsx` · ERSETZEN · 234 Zeilen

**NACHRICHT ANFANG**

Ersetze den GESAMTEN Inhalt der Datei `src/routes/_authed/event.$eventId.jsx` exakt durch diesen Code. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 234 Zeilen haben.

```jsx
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getEventDetail } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill, EvCell, OddsDisplay, ConfidencePill, ProbBar, QualityBadge, EmptyState } from "@/components/betting/UiBits";
import { formatPercent } from "@/lib/oddsMath";
import { buildAnalysisPackage } from "@/lib/analysisPackage";
import { STANDALONE_SYSTEM_PROMPT } from "@/lib/analystPrompts";
import { toast } from "sonner";
import { ArrowLeft, TrendingUp, Activity, ShieldAlert, AlertTriangle, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authed/event/$eventId")({
  ssr: false,
  loader: async ({ params }) => {
    const detail = await getEventDetail({ data: { id: params.eventId } });
    if (!detail) throw notFound();
    return detail;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.event?.home_team_name} vs ${loaderData?.event?.away_team_name}` }] }),
  component: EventDetail,
});

function EventDetail() {
  const d = Route.useLoaderData();
  const { event, markets, selections, predictions, injuries, lineups, snapshots, signals, provenance, odds_fresh, kickoff_passed, mapping_confident, is_demo, verifiable, prediction_computed, model_version } = d;
  const prediction = predictions[0];
  const kickoff = event.kickoff_utc ? new Date(event.kickoff_utc).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : "TBD";
  const oddsObserved = snapshots[0]?.source_timestamp ? new Date(snapshots[0].source_timestamp).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : null;
  const oddsImported = snapshots[0]?.retrieval_timestamp ? new Date(snapshots[0].retrieval_timestamp).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/"><ArrowLeft className="w-4 h-4 mr-1" />Back</Link></Button>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-heading font-bold">{event.home_team_name} <span className="text-muted-foreground">vs</span> {event.away_team_name}</h1>
          <p className="text-sm text-muted-foreground">{event.competition_name || "—"} · {kickoff} (America/Asuncion) · <span className="capitalize">{event.status}</span></p>
          {event.aposta_event_id && <p className="text-xs text-muted-foreground font-mono">Aposta ID: {event.aposta_event_id}{event.aposta_event_url ? <a href={event.aposta_event_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center text-chart-1 hover:underline">Source <ExternalLink className="w-3 h-3 ml-0.5" /></a> : null}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copyText(JSON.stringify(buildAnalysisPackage(d), null, 2), "Paquete copiado")}>Copiar paquete para IA</Button>
          <Button variant="ghost" size="sm" onClick={() => copyText(STANDALONE_SYSTEM_PROMPT, "Prompt copiado")}>Copiar prompt</Button>
          <Badge variant="outline" className={is_demo ? "text-red-400 border-red-500/40 bg-red-500/10" : verifiable ? "text-emerald-400 border-emerald-500/30" : "text-amber-400 border-amber-500/30"}>{provenance.label}</Badge>
          {event.is_locked && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Locked (kickoff passed)</Badge>}
          {kickoff_passed && !event.is_locked && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Kickoff passed</Badge>}
          {event.mapping_status !== "matched" && <Badge variant="outline" className="text-orange-400 border-orange-500/30 capitalize">Mapping: {event.mapping_status}</Badge>}
          {!mapping_confident && event.mapping_status === "matched" && <Badge variant="outline" className="text-orange-400 border-orange-500/30">Mapping unconfirmed</Badge>}
        </div>
      </div>

      {/* Provenance / data-availability banner */}
      {!verifiable && (
        <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-400">{is_demo ? "DEMO DATA — not a real Aposta event" : "Aposta data unavailable"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{is_demo ? "This record is test data and is excluded from active recommendations and performance metrics." : "No verifiable Aposta source for this event. Recommendations are suppressed until provenance is confirmed."}</p>
          </div>
        </div>
      )}

      {/* Odds provenance detail */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Import method</p><p className="font-medium capitalize">{provenance.source.replace(/_/g, " ")}</p></div>
        <div><p className="text-xs text-muted-foreground">Odds observed</p><p className="font-medium">{oddsObserved || "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Odds imported</p><p className="font-medium">{oddsImported || "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Odds freshness</p><p className={`font-medium ${odds_fresh ? "text-emerald-400" : "text-amber-400"}`}>{odds_fresh ? "Fresh (<30 min)" : event.last_odds_sync_at ? "Stale" : "Missing"}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Prediction */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Model Prediction</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {prediction && prediction.computation_status !== "computed" ? (
              <div className="text-sm space-y-1">
                <p className="font-medium text-amber-400">No forecast — insufficient data</p>
                <p className="text-xs text-muted-foreground">The model needs at least 6 verified pre-kickoff results per team. Reasons: {(prediction.insufficient_reasons || []).join(", ") || "not recorded"}</p>
              </div>
            ) : prediction ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">1X2 Probability</p>
                  <ProbBar home={prediction.probabilities?.home} draw={prediction.probabilities?.draw} away={prediction.probabilities?.away} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><p className="text-xs text-muted-foreground">Exp. Goals Home</p><p className="text-lg font-bold font-mono">{prediction.expected_goals_home?.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Exp. Goals Away</p><p className="text-lg font-bold font-mono">{prediction.expected_goals_away?.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Version</p><p className="text-lg font-bold font-mono">v{prediction.version}</p></div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Confidence:</span>
                  <ConfidencePill confidence={prediction.confidence} />
                  <span className="text-muted-foreground">Model {model_version?.label || "—"} · {model_version?.validation_status || "unvalidated"} · {prediction.calibration_status || "uncalibrated"}</span>
                </div>
              </>
            ) : (
              <EmptyState icon={Activity} title="No prediction yet" hint="Run the prediction pipeline from Admin to generate a model forecast." />
            )}
          </CardContent>
        </Card>

        {/* Data quality */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4" />Data Quality</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {prediction?.data_quality ? (
              Object.entries(prediction.data_quality).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</span><QualityBadge quality={v} /></div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No data quality snapshot available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Value signals */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Value Signals</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!verifiable || !prediction_computed ? (
            <div className="px-4 py-3 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {is_demo ? "Signals suppressed — demo data." : !verifiable ? "Signals suppressed — unverified data source." : "Signals suppressed — prediction not computed from verifiable inputs."}
            </div>
          ) : signals.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No active value signals" />
          ) : (
            <div className="divide-y divide-border">
              {signals.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium capitalize">{s.market_key.replace(/_/g, " ")} · {s.selection}{s.line != null ? ` ${s.line}` : ""}</p>
                    <p className="text-xs text-muted-foreground">Model: {formatPercent(s.model_probability)}{s.probability_interval ? ` (±1 SE ${formatPercent(s.probability_interval[0])}–${formatPercent(s.probability_interval[1])})` : ""} · No-vig: {formatPercent(s.aposta_no_vig_probability)}</p>
                    <p className={`text-xs ${s.published ? "text-emerald-400" : "text-muted-foreground"}`}>{s.published ? "Published recommendation" : `Not recommended: ${(s.gate_reasons || []).join(", ").replace(/_/g, " ")}`}</p>
                  </div>
                  <div className="text-right"><OddsDisplay odds={s.aposta_odds} /><EvCell ev={s.expected_value} /></div>
                  <StatusPill status={s.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Markets & odds */}
      <Card>
        <CardHeader><CardTitle className="text-base">Markets & Live Odds</CardTitle></CardHeader>
        <CardContent className="p-0">
          {markets.length === 0 ? <EmptyState title="No markets loaded" /> : (
            <div className="divide-y divide-border">
              {markets.map((m) => {
                const sels = selections.filter((s) => s.market_id === m.id);
                return (
                  <div key={m.id} className="px-4 py-3">
                    <p className="text-sm font-medium capitalize mb-2">{m.market_name || m.market_key.replace(/_/g, " ")}{m.line != null ? ` (${m.line})` : ""}</p>
                    <div className="flex flex-wrap gap-2">
                      {sels.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1">
                          <span className="text-xs capitalize">{s.selection}</span>
                          <OddsDisplay odds={s.current_odds} />
                          {s.opening_odds && s.current_odds < s.opening_odds && <span className="text-xs text-emerald-400">▼</span>}
                          {s.opening_odds && s.current_odds > s.opening_odds && <span className="text-xs text-red-400">▲</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Injuries & lineups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Lineups</CardTitle></CardHeader>
          <CardContent>
            {lineups.length === 0 ? <p className="text-xs text-muted-foreground">No lineup data.</p> : (
              <div className="space-y-2">
                {lineups.map((l) => (
                  <div key={l.id} className="text-sm">
                    <p className="font-medium">{l.is_home ? event.home_team_name : event.away_team_name} <span className="text-xs text-muted-foreground">({l.formation || "—"})</span></p>
                    <p className="text-xs text-muted-foreground capitalize">{l.status}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Injuries & Suspensions</CardTitle></CardHeader>
          <CardContent>
            {injuries.length === 0 ? <p className="text-xs text-muted-foreground">No injury data.</p> : (
              <div className="space-y-1">
                {injuries.map((i, idx) => (
                  <div key={idx} className="text-sm flex justify-between"><span>{i.player_name}</span><Badge variant="outline" className="text-xs capitalize">{i.status}</Badge></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Odds history */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Odds History (immutable snapshots)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {snapshots.slice(0, 50).map((s) => (
                <div key={s.id} className="flex justify-between px-4 py-2 text-xs">
                  <span className="capitalize">{s.market_key} · {s.selection}{s.line != null ? ` ${s.line}` : ""}</span>
                  <span className="font-mono">{s.decimal_odds.toFixed(2)}</span>
                  <span className="text-muted-foreground">{new Date(s.retrieval_timestamp).toLocaleTimeString("en-US", { timeZone: "UTC" })}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Clipboard export for the standalone analyst (prompt + analysis package).
async function copyText(text, okMessage) {
  try { await navigator.clipboard.writeText(text); toast.success(okMessage); }
  catch { toast.error("No se pudo copiar al portapapeles"); }
}
```

**NACHRICHT ENDE**

---

## 10/10 · `base44/agents/edge-analyst.jsonc` · ERSETZEN · 66 Zeilen

**NACHRICHT ANFANG**

Ersetze den GESAMTEN Inhalt der Datei `base44/agents/edge-analyst.jsonc` exakt durch diesen Code. Übernimm den Code wörtlich: nichts kürzen, nichts umformulieren, keine anderen Dateien ändern, keine Platzhalter einfügen. Die Datei muss danach genau 66 Zeilen haben.

```jsonc
{
  "name": "edge-analyst",
  "title": "Edge Analyst",
  "description": "In-app AI assistant grounded in the Aposta Edge AI platform's real data. Answers questions about value signals, match analysis, model performance and provider health. Never invents matches, odds, probabilities or recommendations — it only reports what the platform's deterministic models and stored data show.",
  "instructions": "You are the Edge Analyst for Aposta Edge AI, a quantitative football betting analysis platform.\n\nABSOLUTE RULES:\n1. You may ONLY discuss events, odds, probabilities, value signals and recommendations that exist in the platform's database. Never invent or estimate games, odds, probabilities, expected values, team names, scores or recommendations.\n2. All probabilities come from the platform's deterministic statistical model (independent Poisson on recent-form features; Elo only when fitted). Never present your own numerical probabilities. This agent has NO access to value signals or recommendations: those are only available through the in-app Edge Analyst, which applies the publication gate. Never describe any market as value or as a recommendation.\n3. When mentioning a value signal or recommendation, always include its status, expected value, and the data-quality and confidence indicators.\n4. Always answer in Spanish (users in Paraguay). Be concise and direct. Use bullet points. Stakes, if ever mentioned, are always a flat 1 unit.\n5. You do not give financial advice. You present analysis; the user decides. Never encourage reckless betting.\n\nIf you do not have data for a question, say plainly that there is not enough data and do not speculate.",
  "model": "automatic",
  "temperature": 0.2,
  "tools": [
    {
      "type": "entity",
      "entity_name": "Event",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "Market",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "Selection",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "Prediction",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "PredictionOutcome",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "ProviderHealth",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "Team",
      "operations": [
        "read"
      ]
    },
    {
      "type": "entity",
      "entity_name": "Competition",
      "operations": [
        "read"
      ]
    }
  ]
}
```

**NACHRICHT ENDE**

