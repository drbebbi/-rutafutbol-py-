// Data pipeline orchestration. Each job is observable via SyncRun records.
// All work uses the service-role client so admin-only entities are writable.
//
// Integrity rules enforced here (see docs/AUDIT.md for the findings behind them):
//   * Odds snapshots are append-only and idempotent (snapshot_key); the live
//     Selection row always points at the snapshot it was copied from.
//   * Odds age is the OBSERVATION time at the source. A manual import without a
//     source timestamp has unknown age and is never "fresh".
//   * Predictions are only "computed" with verified pre-kickoff features; the
//     unfitted Elo prior is never used as information.
//   * Value signals are built by the pure valueSignals module with explicit
//     suppression reasons; recommendations are an append-only ledger.
//   * Results come from the mapped fixture provider; settlement is idempotent.

import { normalizeApostaEvent, validateApostaImport, APOSTA_PROVIDER_NAME } from "./apostaNormalizer.js";
import { resolveTeam, resolveCompetition, rankFixtures, SAFE_THRESHOLD, AMBIGUOUS_THRESHOLD } from "./eventMatcher.js";
import { supportedMarket } from "../valueEngine.js";
import { impliedProbability, noVigNormalize } from "../oddsMath.js";
import { featuresFromRecords, validateFeatures } from "./features.js";
import { buildModelLambdas, lambdaStandardErrors, predictAllMarkets, MODEL_COMPONENTS } from "./modelInputs.js";
import { buildValueSignals, SUPPORTED_MARKETS } from "./valueSignals.js";
import { CLOCK_SKEW_MS, signalEligibility } from "./provenance.js";
import { settleSelection, profitUnits, outcome1x2, forecastSummary, bettingSummary } from "../metrics.js";

// Lazy imports for modules that depend on base44:runtime (secrets).
// This keeps the pipeline testable without mocking the runtime.
let _aposta, _football;
const apostaMod = () => (_aposta ??= import("./apostaProvider.server.js"));
const footballMod = () => (_football ??= import("./footballDataProvider.server.js"));

const now = () => new Date().toISOString();
const MODEL_VERSION_LABEL = "2.0.0-form-poisson";
const RESULT_CHECK_DELAY_MS = 2 * 60 * 60 * 1000;

// --- SyncRun wrapper ---
export async function recordSyncRun(base44, jobName, trigger, fn) {
  let run;
  try {
    run = await base44.entities.SyncRun.create({ job_name: jobName, status: "running", started_at: now(), trigger });
  } catch (e) {
    return fn({ run: null });
  }
  try {
    const result = await fn({ run });
    await base44.entities.SyncRun.update(run.id, {
      status: result?.failed > 0 ? "partial" : "success",
      finished_at: now(),
      items_processed: result?.processed ?? 0,
      items_failed: result?.failed ?? 0,
      details: result?.details || null,
    });
    return result;
  } catch (err) {
    await base44.entities.SyncRun.update(run.id, {
      status: "failed",
      finished_at: now(),
      error_details: String(err?.message || err).slice(0, 500),
    });
    throw err;
  }
}


// --- Concurrency guard -------------------------------------------------------
// Best-effort lease on PipelineLease. Base44 entities offer no compare-and-set,
// so two workers starting within milliseconds can both win; the read-back below
// narrows that window and every job is additionally idempotent (snapshot_key,
// stat_key, outcome_key, recommendation_key), so a double run cannot duplicate
// history. A stale lease (older than ttl) is taken over after a crash/restart.
export async function acquireLease(base44, scope, ttlMs = 15 * 60 * 1000) {
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const page = await base44.entities.PipelineLease.filter({ scope }, { limit: 1 });
  const held = page.items?.[0];
  if (held && Date.now() - Date.parse(held.acquired_at) < ttlMs) return null;
  if (held) await base44.entities.PipelineLease.update(held.id, { owner, acquired_at: now() });
  else await base44.entities.PipelineLease.create({ scope, owner, acquired_at: now() });
  const check = await base44.entities.PipelineLease.filter({ scope }, { limit: 1 });
  if (check.items?.[0]?.owner !== owner) return null;
  return { scope, owner, release: () => base44.entities.PipelineLease.filter({ scope }, { limit: 1 })
    .then((p) => (p.items?.[0]?.owner === owner ? base44.entities.PipelineLease.delete(p.items[0].id) : null)).catch(() => {}) };
}

// --- Teams & competitions ------------------------------------------------------
async function ensureTeam(base44, name, sport = "football", country = null) {
  if (!name) return null;
  const found = await resolveTeam(base44, name, sport);
  if (found) return found.team;
  return base44.entities.Team.create({ name, sport, country, elo_rating: 1500, elo_games: 0 });
}

async function ensureCompetition(base44, name, country = null, sport = "football") {
  if (!name) return null;
  const found = await resolveCompetition(base44, name, country);
  if (found) return found.competition;
  return base44.entities.Competition.create({ name, country, sport });
}

// Link internal teams to the fixture provider's team ids. Refuses to overwrite
// an existing, different id (that would silently swap a club's history).
export async function linkTeamExternalId(base44, teamId, externalTeamId) {
  if (!teamId || !externalTeamId) return { linked: false, reason: "missing_id" };
  const team = await base44.entities.Team.get(teamId).catch(() => null);
  if (!team) return { linked: false, reason: "team_not_found" };
  const current = team.external_ids?.football_data_id;
  if (current && String(current) !== String(externalTeamId)) return { linked: false, reason: "external_id_conflict", current };
  const other = await base44.entities.Team.filter({ "external_ids.football_data_id": String(externalTeamId) }, { limit: 2 }).catch(() => ({ items: [] }));
  if ((other.items || []).some((t) => t.id !== teamId)) return { linked: false, reason: "external_id_already_used" };
  if (!current) await base44.entities.Team.update(teamId, { external_ids: { ...(team.external_ids || {}), football_data_id: String(externalTeamId) } });
  return { linked: true };
}

// --- Events ----------------------------------------------------------------------
const TERMINAL_STATUSES = ["finished", "cancelled"];

// Upsert an Aposta event (dedupe by aposta_event_id).
// Uses the CANONICAL field contract: home_team_name, away_team_name, competition_name.
// Validates the entire import before any DB write. A kickoff change is
// versioned (kickoff_history) and invalidates the current prediction and
// signals; a provider update never reopens a finished/cancelled event.
export async function upsertApostaEvent(base44, normalized, provenance = "unknown") {
  if (!normalized || !normalized.aposta_event_id) return null;

  const validation = validateApostaImport(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid Aposta import: ${validation.errors.join(", ")}`);
  }

  const existing = await base44.entities.Event.filter({ aposta_event_id: normalized.aposta_event_id }, { limit: 1 });
  const homeTeam = await ensureTeam(base44, normalized.home_team_name, normalized.sport, normalized.country);
  const awayTeam = await ensureTeam(base44, normalized.away_team_name, normalized.sport, normalized.country);
  const competition = await ensureCompetition(base44, normalized.competition_name, normalized.country, normalized.sport);

  const payload = {
    sport: normalized.sport,
    aposta_event_id: normalized.aposta_event_id,
    aposta_event_url: normalized.event_url,
    competition_id: competition?.id || null,
    competition_name: normalized.competition_name,
    country: normalized.country,
    home_team_id: homeTeam?.id || null,
    away_team_id: awayTeam?.id || null,
    home_team_name: normalized.home_team_name,
    away_team_name: normalized.away_team_name,
    kickoff_utc: normalized.kickoff_utc,
    status: normalized.status,
    provenance,
    imported_at: now(),
  };
  const ev = existing.items?.[0];
  if (!ev) return base44.entities.Event.create({ ...payload, mapping_status: "unmatched", is_locked: false, kickoff_history: [] });

  if (TERMINAL_STATUSES.includes(ev.status)) delete payload.status;
  // A manual re-import invalidates a previous admin verification.
  if (provenance === "manual_import") Object.assign(payload, { source_verified_at: null, source_verified_by: null });
  // Teams changed → the old fixture mapping no longer applies.
  if ((ev.home_team_id && ev.home_team_id !== payload.home_team_id) || (ev.away_team_id && ev.away_team_id !== payload.away_team_id)) {
    Object.assign(payload, { mapping_status: "unmatched", mapping_confidence: 0, external_event_id: null });
  }
  const oldKick = Date.parse(ev.kickoff_utc), newKick = Date.parse(payload.kickoff_utc);
  const kickoffChanged = Number.isFinite(oldKick) && Number.isFinite(newKick) && Math.abs(oldKick - newKick) > 60 * 1000;
  const statusChanged = payload.status && payload.status !== ev.status && payload.status !== "scheduled";
  if (kickoffChanged) {
    payload.kickoff_history = [...(ev.kickoff_history || []), { kickoff_utc: ev.kickoff_utc, replaced_at: now() }];
    if (newKick > Date.now()) payload.is_locked = false; // postponed into the future: pre-match again
  }
  if (kickoffChanged || statusChanged) await invalidateEventDerivations(base44, ev.id, kickoffChanged ? "kickoff_changed" : `status_${payload.status}`);
  return base44.entities.Event.update(ev.id, payload);
}

// Mark the current prediction as superseded and deactivate the event's signals.
async function invalidateEventDerivations(base44, eventId, reason) {
  const preds = await base44.entities.Prediction.filter({ event_id: eventId }, { limit: 1, sort: "-version" });
  const latest = preds.items?.[0];
  if (latest && !latest.superseded_by) await base44.entities.Prediction.update(latest.id, { superseded_by: `invalidated:${reason}` }).catch(() => {});
  await base44.entities.ValueSignal.updateMany({ event_id: eventId, is_active: true }, { $set: { is_active: false } }).catch(() => {});
}

// --- Odds ------------------------------------------------------------------------
// Record an immutable odds snapshot AND point the live Selection at it.
//   source_timestamp  — time the source says the price was valid (may be null)
//   retrieval_timestamp — when we fetched/imported it
//   odds_observed_at (Selection) — the age used for freshness: the source time;
//     for the live API feed (opts.trustRetrievalTime) the retrieval time when the
//     source sends none. A manual import without source time has UNKNOWN age.
// Timestamps further in the future than the clock-skew tolerance are rejected.
// Re-importing the identical observation does not create a second snapshot.
export async function recordOddsSnapshot(
  base44, eventId, marketKey, selection, odds, line, marketId,
  marketStatus = "unknown", selectionStatus = "unknown", sourceTimestamp = null, opts = {}
) {
  const retrievalTs = now();
  let observedAt = null;
  if (sourceTimestamp) {
    const ts = Date.parse(sourceTimestamp);
    if (Number.isFinite(ts) && ts <= Date.now() + CLOCK_SKEW_MS) observedAt = sourceTimestamp;
  }
  const freshnessTs = observedAt || (opts.trustRetrievalTime ? retrievalTs : null);
  // Market status overrides an "open" selection: a suspended market has no open prices.
  const effectiveSelStatus = marketStatus !== "open" && selectionStatus === "open" ? marketStatus : selectionStatus;

  const snapshotKey = `${eventId}:${marketId}:${selection}:${line ?? ""}:${observedAt || retrievalTs}:${odds}:${effectiveSelStatus}`;
  const dup = observedAt ? await base44.entities.OddsSnapshot.filter({ snapshot_key: snapshotKey }, { limit: 1 }) : { items: [] };
  const snapshot = dup.items?.[0] || await base44.entities.OddsSnapshot.create({
    event_id: eventId,
    market_id: marketId,
    market_key: marketKey,
    selection,
    line: line ?? null,
    bookmaker: APOSTA_PROVIDER_NAME,
    decimal_odds: odds,
    market_status: marketStatus,
    selection_status: effectiveSelStatus,
    retrieval_timestamp: retrievalTs,
    source_timestamp: observedAt,
    observed_at: observedAt,
    implied_probability: impliedProbability(odds),
    snapshot_key: snapshotKey,
    source_verified: false,
    origin: opts.origin || null,
  });

  const selPage = await base44.entities.Selection.filter({ market_id: marketId, selection }, { limit: 1 });
  const live = {
    current_odds: odds,
    odds_updated_at: retrievalTs,
    odds_observed_at: freshnessTs,
    last_success_at: retrievalTs,
    status: effectiveSelStatus,
    is_suspended: effectiveSelStatus === "suspended",
    current_snapshot_id: snapshot.id,
  };
  const s = selPage.items?.[0];
  if (s) {
    await base44.entities.Selection.update(s.id, {
      ...live,
      opening_odds: s.opening_odds ?? odds,
      highest_odds: Math.max(s.highest_odds ?? odds, odds),
      lowest_odds: s.lowest_odds == null ? odds : Math.min(s.lowest_odds, odds),
    });
  } else {
    await base44.entities.Selection.create({
      market_id: marketId, event_id: eventId, selection, line: line ?? null,
      opening_odds: odds, highest_odds: odds, lowest_odds: odds, ...live,
    });
  }
  return snapshot;
}

// Ensure a Market record exists for an event + market key + line + period.
export async function ensureMarket(
  base44, eventId, marketKey, marketName, line, tier = 1,
  providerMarketId = null, status = "unknown", period = "full_time", providerMarketName = null
) {
  const page = await base44.entities.Market.filter({ event_id: eventId, market_key: marketKey, line: line ?? null }, { limit: 5 });
  const existing = (page.items || []).find((m) => (m.period || "full_time") === (period || "full_time"));
  if (existing) {
    if (existing.status !== status) {
      await base44.entities.Market.update(existing.id, { status, last_success_at: now() });
      existing.status = status;
    }
    return existing;
  }
  return base44.entities.Market.create({
    event_id: eventId, market_key: marketKey, market_name: marketName, line, tier,
    provider_market_id: providerMarketId, status, period, provider_market_name: providerMarketName,
  });
}

async function ingestMarkets(base44, eventId, markets, opts) {
  let written = 0;
  for (const m of markets) {
    if (!supportedMarket(m.market_key, m.line, m.period)) continue;
    const market = await ensureMarket(base44, eventId, m.market_key, m.market_name, m.line, m.tier || 1,
      m.provider_market_id, m.status, m.period, m.provider_market_name);
    for (const sel of m.selections) {
      if (Number.isFinite(sel.odds) && sel.odds > 1) {
        await recordOddsSnapshot(base44, eventId, m.market_key, sel.selection, sel.odds, sel.line ?? m.line, market.id,
          m.status, sel.status, sel.source_timestamp || m.source_timestamp, opts);
        written++;
      }
    }
  }
  return written;
}

// --- JOB: sync Aposta events ---
export async function syncApostaEvents(base44, trigger = "manual") {
  return recordSyncRun(base44, "syncApostaEvents", trigger, async () => {
    const a = await apostaMod();
    const { events, health } = await a.fetchApostaEvents();
    await upsertProviderHealth(base44, APOSTA_PROVIDER_NAME, health.status, health.error);
    let processed = 0, failed = 0;
    const errors = [];
    for (const ev of events) {
      try {
        await upsertApostaEvent(base44, ev, "aposta_api");
        processed++;
      } catch (e) { failed++; errors.push(String(e?.message || e).slice(0, 120)); }
    }
    return { processed, failed, details: { health, errors: errors.slice(0, 10) } };
  });
}

// --- JOB: sync Aposta odds for an event (or all upcoming) ---
// Only a "healthy", complete provider response updates odds and timestamps.
// A healthy response without a previously seen market marks it "missing".
export async function syncApostaOdds(base44, eventId = null, trigger = "manual") {
  return recordSyncRun(base44, "syncApostaOdds", trigger, async () => {
    const a = await apostaMod();
    const events = eventId ? [await base44.entities.Event.get(eventId).catch(() => null)].filter(Boolean) : await upcomingEvents(base44);
    let processed = 0, failed = 0;
    for (const ev of events) {
      await base44.entities.Event.update(ev.id, { last_odds_attempt_at: now() }).catch(() => {});
      try {
        const { markets, health } = await a.fetchApostaOdds(ev.aposta_event_id);
        if (health.status !== "healthy") {
          await base44.entities.Event.update(ev.id, { odds_fetch_status: `${health.status}: ${health.error || "unknown error"}` }).catch(() => {});
          failed++;
          continue;
        }
        await ingestMarkets(base44, ev.id, markets, { trustRetrievalTime: true, origin: "aposta_api" });

        const responseKeys = new Set(markets.map((m) => `${m.market_key}:${m.line ?? ""}`));
        const existingPage = await base44.entities.Market.filter({ event_id: ev.id }, { limit: 100 });
        for (const m of existingPage.items || []) {
          if (!responseKeys.has(`${m.market_key}:${m.line ?? ""}`) && (m.status === "open" || m.status === "unknown")) {
            await base44.entities.Market.update(m.id, { status: "missing" });
          }
        }
        const successTs = now();
        await base44.entities.Event.update(ev.id, { last_odds_sync_at: successTs, last_odds_success_at: successTs, odds_fetch_status: "ok" });
        processed++;
      } catch (e) {
        await base44.entities.Event.update(ev.id, { odds_fetch_status: String(e?.message || e).slice(0, 200) }).catch(() => {});
        failed++;
      }
    }
    return { processed, failed };
  });
}

// Scheduled, not locked, kickoff in the future.
async function upcomingEvents(base44, limit = 100) {
  const page = await base44.entities.Event.filter({ status: "scheduled" }, { limit, sort: "kickoff_utc" });
  const t = Date.now();
  return (page.items || []).filter((e) => !e.is_locked && Number.isFinite(Date.parse(e.kickoff_utc)) && Date.parse(e.kickoff_utc) > t);
}

// --- Manual Aposta event import (admin) ---
// Provenance "manual_import": never eligible for recommendations until an admin
// verifies it against aposta.la (verifyManualEvent). Odds without a source
// timestamp have unknown age and are treated as stale.
export async function importApostaEventManual(base44, rawPayload) {
  const normalized = normalizeApostaEvent(rawPayload);
  const validation = validateApostaImport(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid Aposta event payload: ${validation.errors.join(", ")}`);
  }
  const ev = await upsertApostaEvent(base44, normalized, "manual_import");
  await ingestMarkets(base44, ev.id, normalized.markets, { trustRetrievalTime: false, origin: "manual_import" });
  const ts = now();
  await base44.entities.Event.update(ev.id, { last_odds_sync_at: ts, last_odds_success_at: ts, odds_fetch_status: "ok (manual import)" });
  return ev;
}

// Admin attestation that a manually imported event exists on aposta.la with
// these teams, kickoff and odds. Recorded with who/when; cleared by re-import.
export async function verifyManualEvent(base44, eventId, adminId) {
  const ev = await base44.entities.Event.get(eventId).catch(() => null);
  if (!ev) throw new Error("EVENT_NOT_FOUND");
  if (ev.provenance !== "manual_import") throw new Error("ONLY_MANUAL_IMPORTS_NEED_VERIFICATION");
  return base44.entities.Event.update(eventId, { source_verified_at: now(), source_verified_by: adminId });
}

// --- JOB: match external fixtures ---
// A confirmed match also links both teams to the provider's team ids, which
// is what makes stats, lineups and results retrievable at all.
export async function matchExternalFixtures(base44, trigger = "manual") {
  return recordSyncRun(base44, "matchExternalFixtures", trigger, async () => {
    const f = await footballMod();
    if (!f.isConfigured()) return { processed: 0, failed: 0, details: { note: "Football data provider not configured" } };
    const page = await base44.entities.Event.filter({ mapping_status: { $in: ["unmatched", "ambiguous"] } }, { limit: 50 });
    const byDate = new Map(); // one provider call per date per run (rate limits)
    let processed = 0, failed = 0;
    const notes = [];
    for (const ev of page.items || []) {
      try {
        if (!ev.kickoff_utc) { notes.push({ event_id: ev.id, reason: "no_kickoff" }); continue; }
        const date = ev.kickoff_utc.slice(0, 10);
        if (!byDate.has(date)) byDate.set(date, (await f.getFixturesByDate(date)).fixtures);
        const { best, confirmed, gap, reason } = rankFixtures(ev, byDate.get(date));
        if (confirmed) {
          await applyFixtureMapping(base44, ev, best.fixture, best.confidence, "auto", best.factors);
        } else {
          await base44.entities.Event.update(ev.id, {
            mapping_status: best && best.confidence >= AMBIGUOUS_THRESHOLD ? "ambiguous" : "unmatched",
            mapping_confidence: best?.confidence ?? 0,
            mapping_evidence: { reason, gap, candidate: best?.fixture?.external_event_id ?? null, factors: best?.factors ?? null },
          });
        }
        processed++;
      } catch (e) { failed++; notes.push({ event_id: ev.id, error: String(e?.message || e).slice(0, 120) }); }
    }
    return { processed, failed, details: { notes: notes.slice(0, 20) } };
  });
}

export async function applyFixtureMapping(base44, ev, fixture, confidence, method, factors = null) {
  const extId = String(fixture.external_event_id);
  const home = await linkTeamExternalId(base44, ev.home_team_id, fixture.external_home_team_id);
  const away = await linkTeamExternalId(base44, ev.away_team_id, fixture.external_away_team_id);
  if (!home.linked || !away.linked) {
    // Team identity conflict: do not confirm a mapping whose teams disagree.
    await base44.entities.Event.update(ev.id, { mapping_status: "ambiguous", mapping_confidence: Math.min(confidence, AMBIGUOUS_THRESHOLD),
      mapping_evidence: { reason: "team_id_conflict", home, away, candidate: extId } });
    return { mapped: false, home, away };
  }
  const existing = await base44.entities.EventMapping.filter({ event_id: ev.id, provider: "football_data", external_event_id: extId }, { limit: 1 });
  if (!existing.items?.[0]) {
    await base44.entities.EventMapping.create({ event_id: ev.id, provider: "football_data", external_event_id: extId,
      confidence, match_method: method, match_factors: factors, is_confirmed: true });
  }
  await base44.entities.Event.update(ev.id, { mapping_status: method === "manual" ? "manual" : "matched", mapping_confidence: confidence,
    external_event_id: extId, mapping_evidence: { method, factors, provider_kickoff: fixture.kickoff_utc } });
  return { mapped: true };
}

// --- JOB: sync football data (recent results per team) ---
// Stats are deduplicated by stat_key (provider:fixture:team), so re-running
// the job never inflates a team's sample.
export async function syncFootballData(base44, eventId = null, trigger = "manual") {
  return recordSyncRun(base44, "syncFootballData", trigger, async () => {
    const f = await footballMod();
    if (!f.isConfigured()) return { processed: 0, failed: 0, details: { note: "not configured" } };
    const events = eventId ? [await base44.entities.Event.get(eventId).catch(() => null)].filter(Boolean) : await upcomingEvents(base44, 50);
    const doneTeams = new Set();
    let processed = 0, failed = 0, created = 0;
    const notes = [];
    for (const ev of events) {
      try {
        for (const teamId of [ev.home_team_id, ev.away_team_id]) {
          if (!teamId || doneTeams.has(teamId)) continue;
          doneTeams.add(teamId);
          const team = await base44.entities.Team.get(teamId).catch(() => null);
          const extId = team?.external_ids?.football_data_id;
          if (!extId) { notes.push({ team_id: teamId, reason: "team_not_linked_to_provider" }); continue; }
          const { matches } = await f.getTeamLastMatches(extId, 10);
          for (const m of matches) {
            const statKey = `${m.source}:${m.external_fixture_id}:${teamId}`;
            const dup = await base44.entities.TeamMatchStat.filter({ stat_key: statKey }, { limit: 1 });
            if (dup.items?.[0]) continue;
            await base44.entities.TeamMatchStat.create({
              team_id: teamId, event_id: null, stat_key: statKey, is_home: m.is_home,
              goals: m.goals, goals_conceded: m.goals_conceded,
              played_at: m.played_at, source: m.source,
              known_at: m.known_at, retrieved_at: m.retrieved_at,
              external_fixture_id: m.external_fixture_id, external_team_id: m.external_team_id,
              external_opponent_id: m.external_opponent_id, data_quality: m.data_quality, verified: m.verified,
            });
            created++;
          }
        }
        await base44.entities.Event.update(ev.id, { last_data_sync_at: now() });
        processed++;
      } catch (e) { failed++; notes.push({ event_id: ev.id, error: String(e?.message || e).slice(0, 120) }); }
    }
    return { processed, failed, details: { created, notes: notes.slice(0, 20) } };
  });
}

// --- JOB: update injuries and lineups ---
export async function updateInjuriesAndLineups(base44, eventId, trigger = "manual") {
  return recordSyncRun(base44, "updateInjuriesAndLineups", trigger, async () => {
    const f = await footballMod();
    const ev = eventId ? await base44.entities.Event.get(eventId).catch(() => null) : null;
    if (!ev || !ev.external_event_id) return { processed: 0, failed: 0, details: { note: "no external mapping" } };
    const teams = await Promise.all([ev.home_team_id, ev.away_team_id].map((id) => (id ? base44.entities.Team.get(id).catch(() => null) : null)));
    const sideOf = (extTeamId) => teams.findIndex((t) => t?.external_ids?.football_data_id === String(extTeamId));
    let processed = 0, failed = 0, skipped = 0;
    try {
      const { lineups } = await f.getLineups(ev.external_event_id);
      let confirmedBoth = lineups.length === 2;
      for (const lp of lineups) {
        const side = sideOf(lp.external_team_id);
        if (side < 0) { skipped++; confirmedBoth = false; continue; } // never guess the team
        if (!lp.confirmed) confirmedBoth = false;
        await base44.entities.Lineup.create({
          event_id: ev.id, team_id: teams[side].id, is_home: side === 0, status: lp.confirmed ? "confirmed" : "expected",
          formation: lp.formation, players: lp.players || [], source: lp.source || "api_football", retrieved_at: lp.retrieved_at,
        });
      }
      const { injuries } = await f.getInjuries(ev.external_event_id);
      for (const inj of injuries) {
        const side = sideOf(inj.external_team_id);
        if (side < 0) { skipped++; continue; }
        await base44.entities.Injury.create({
          team_id: teams[side].id, event_id: ev.id, player_name: inj.player_name, reason: inj.reason, status: inj.status,
          source: inj.source || "api_football", retrieved_at: inj.retrieved_at,
        });
      }
      await base44.entities.Event.update(ev.id, { lineup_status: confirmedBoth ? "confirmed" : lineups.length ? "expected" : "not_confirmed" });
      processed = 1;
    } catch (e) { failed = 1; }
    return { processed, failed, details: { skipped_unmapped_team: skipped } };
  });
}

// --- Features (point-in-time) ---
export async function generateFeatures(base44, eventId, asOf = new Date().toISOString()) {
  const ev = await base44.entities.Event.get(eventId).catch(() => null);
  if (!ev) return null;
  const kickoff = ev.kickoff_utc || asOf;
  const records = {};
  for (const [side, teamId] of [["home", ev.home_team_id], ["away", ev.away_team_id]]) {
    if (!teamId) { records[side] = []; continue; }
    const page = await base44.entities.TeamMatchStat.filter({ team_id: teamId }, { limit: 40, sort: "-played_at" });
    records[side] = page.items || [];
  }
  return featuresFromRecords(records.home, records.away, asOf, kickoff);
}

// --- Data quality: measured, per dimension. No synthetic overall score. ---
export async function computeDataQuality(base44, event, features = null) {
  const lineupPage = await base44.entities.Lineup.filter({ event_id: event.id }, { limit: 4, sort: "-retrieved_at" });
  const lineups = lineupPage.items || [];
  const minSample = Math.min(features?.home?.sample_size ?? 0, features?.away?.sample_size ?? 0);
  const featuresValid = features ? validateFeatures(features).valid : false;
  return {
    fixture_mapping: (event.mapping_confidence ?? 0) >= SAFE_THRESHOLD && event.external_event_id ? "good" : event.mapping_status === "ambiguous" ? "acceptable" : "missing",
    stats_completeness: featuresValid ? (minSample >= 10 ? "full" : "partial") : "missing",
    lineup_quality: lineups.length >= 2 && lineups.slice(0, 2).every((l) => l.status === "confirmed") ? "confirmed" : lineups.length ? "expected" : "not_confirmed",
    injury_quality: "not_modelled",
    model_sample_quality: featuresValid ? (minSample >= 10 ? "sufficient" : "limited") : "insufficient",
    sample_size_home: features?.home?.sample_size ?? 0,
    sample_size_away: features?.away?.sample_size ?? 0,
  };
}

// --- JOB: run prediction models (versioned, immutable) ---
// Produces a new Prediction version. computation_status is "computed" only
// with valid features; otherwise "insufficient_data" with reasons (stored so
// the UI and the analyst can explain why there is no forecast).
export async function runPredictionModels(base44, eventId = null, triggerSource = "initial") {
  return recordSyncRun(base44, "runPredictionModels", "event", async () => {
    const events = eventId ? [await base44.entities.Event.get(eventId).catch(() => null)].filter(Boolean) : await upcomingEvents(base44, 50);
    let processed = 0, failed = 0;
    const results = [];
    for (const ev of events) {
      try {
        const r = await predictEvent(base44, ev, triggerSource);
        results.push({ event_id: ev.id, ...r });
        processed++;
      } catch (e) { failed++; results.push({ event_id: ev.id, error: String(e?.message || e).slice(0, 120) }); }
    }
    return { processed, failed, details: { results: results.slice(0, 20) } };
  });
}

async function predictEvent(base44, ev, triggerSource) {
  const predictedAt = now();
  if (ev.is_locked || !(Date.parse(ev.kickoff_utc) > Date.parse(predictedAt))) return { skipped: "kickoff_passed_or_locked" };
  if (ev.status !== "scheduled") return { skipped: `event_${ev.status}` };
  const modelVersion = await ensureProductionModel(base44);
  const [homeTeam, awayTeam] = await Promise.all([ev.home_team_id, ev.away_team_id].map((id) => (id ? base44.entities.Team.get(id).catch(() => null) : null)));
  const features = await generateFeatures(base44, ev.id, predictedAt);
  const model = buildModelLambdas({ features, homeTeam, awayTeam });
  const dq = await computeDataQuality(base44, ev, features);

  let marketProbabilities = null, intervals = null, point = null;
  if (model.status === "computed") {
    const out = predictAllMarkets(model.lambdas, lambdaStandardErrors(features));
    point = out.point; marketProbabilities = out.probabilities; intervals = out.intervals;
  }
  const inputKey = JSON.stringify({ f: [features?.home?.source_record_ids, features?.away?.source_record_ids], k: ev.kickoff_utc, mv: modelVersion.id });

  const existing = await base44.entities.Prediction.filter({ event_id: ev.id }, { limit: 1, sort: "-version" });
  const prev = existing.items?.[0];
  if (prev && prev.input_key === inputKey && !prev.superseded_by) return { skipped: "inputs_unchanged", prediction_id: prev.id };
  const nextVersion = (prev?.version || 0) + 1;

  const prediction = await base44.entities.Prediction.create({
    event_id: ev.id,
    model_version_id: modelVersion.id,
    version: nextVersion,
    predecessor_id: prev?.id || null,
    trigger: triggerSource,
    market_key: "1x2",
    computation_status: model.status,
    insufficient_reasons: model.reasons,
    probabilities: marketProbabilities?.["1x2"] || null,
    market_probabilities: marketProbabilities,
    probability_intervals: intervals,
    lambda_home: model.lambdas?.lambdaHome ?? null,
    lambda_away: model.lambdas?.lambdaAway ?? null,
    expected_goals_home: model.lambdas?.lambdaHome ?? null,
    expected_goals_away: model.lambdas?.lambdaAway ?? null,
    score_distribution: point?.correctScore || null,
    component_contributions: model.components,
    feature_snapshot: features,
    data_quality: dq,
    confidence: "low",
    confidence_score: null,
    predicted_at: predictedAt,
    as_of: features?.as_of || predictedAt,
    kickoff_at_prediction: ev.kickoff_utc,
    is_locked: false,
    calibration_status: "UNCALIBRATED",
    rho: 0,
    tail_mass: point?.tail_mass ?? null,
    input_key: inputKey,
    schema_version: 2,
  });
  if (prev && !prev.superseded_by) await base44.entities.Prediction.update(prev.id, { superseded_by: prediction.id }).catch(() => {});
  return { prediction_id: prediction.id, version: nextVersion, computation_status: model.status, reasons: model.reasons };
}

// The production model version is labelled honestly: independent Poisson on
// form features (Elo only when fitted), no Dixon-Coles rho, no calibration.
// validation_status stays "unvalidated" until a recorded out-of-sample
// backtest is attached by an admin; unvalidated models never publish.
async function ensureProductionModel(base44) {
  const page = await base44.entities.Model.filter({ is_active: true }, { limit: 1 });
  let model = page.items?.[0];
  if (!model) model = await base44.entities.Model.create({ name: "Football Form-Poisson", sport: "football", type: "ensemble", is_active: true });
  const vp = await base44.entities.ModelVersion.filter({ model_id: model.id, version_label: MODEL_VERSION_LABEL }, { limit: 1 });
  if (vp.items?.[0]) return vp.items[0];
  const old = await base44.entities.ModelVersion.filter({ model_id: model.id, is_production: true }, { limit: 20 });
  for (const v of old.items || []) await base44.entities.ModelVersion.update(v.id, { is_production: false }).catch(() => {});
  return base44.entities.ModelVersion.create({
    model_id: model.id, version_label: MODEL_VERSION_LABEL, components: MODEL_COMPONENTS,
    calibration_method: "none", is_production: true, validation_status: "unvalidated",
  });
}

// --- JOB: calculate value signals ---
export async function calculateValueSignals(base44, eventId = null, trigger = "manual") {
  return recordSyncRun(base44, "calculateValueSignals", trigger, async () => {
    const events = eventId ? [await base44.entities.Event.get(eventId).catch(() => null)].filter(Boolean) : await upcomingEvents(base44, 50);
    let processed = 0, failed = 0, recorded = 0;
    for (const ev of events) {
      try {
        const out = await valueSignalsForEvent(base44, ev);
        processed += out.signals;
        recorded += out.recommendations;
      } catch (e) { failed++; }
    }
    return { processed, failed, details: { recommendations_recorded: recorded } };
  });
}

async function valueSignalsForEvent(base44, ev) {
  const predPage = await base44.entities.Prediction.filter({ event_id: ev.id }, { limit: 1, sort: "-version" });
  const prediction = predPage.items?.[0] || null;
  const marketsPage = await base44.entities.Market.filter({ event_id: ev.id }, { limit: 50 });
  const markets = [];
  for (const market of marketsPage.items || []) {
    if (!SUPPORTED_MARKETS.some((s) => s.market_key === market.market_key && (s.line ?? null) === (market.line ?? null))) continue;
    const sels = await base44.entities.Selection.filter({ market_id: market.id }, { limit: 10 });
    markets.push({ market, selections: sels.items || [] });
  }
  const signals = buildValueSignals({ event: ev, prediction, markets });
  await base44.entities.ValueSignal.updateMany({ event_id: ev.id, is_active: true }, { $set: { is_active: false } });
  let recs = 0;
  for (const sig of signals) {
    const created = await base44.entities.ValueSignal.create(sig);
    if (sig.status === "value" || sig.status === "strong_value") recs += await recordRecommendation(base44, ev, prediction, created);
  }
  return { signals: signals.length, recommendations: recs };
}

// Append-only recommendation ledger. One row per (signal_key, odds snapshot):
// the price at which the platform flagged value. `published` records whether
// the full eligibility gate (provenance, validated model, ...) passed at that
// moment — unpublished rows are the shadow track record of the model.
async function recordRecommendation(base44, ev, prediction, signal) {
  const key = `${signal.signal_key}:${signal.odds_snapshot_id}`;
  const dup = await base44.entities.Recommendation.filter({ recommendation_key: key }, { limit: 1 });
  if (dup.items?.[0]) return 0;
  const [selection, modelVersion] = await Promise.all([
    base44.entities.Selection.get(signal.selection_id).catch(() => null),
    prediction?.model_version_id ? base44.entities.ModelVersion.get(prediction.model_version_id).catch(() => null) : null,
  ]);
  const { eligible, reasons } = signalEligibility({ signal, event: ev, prediction, selection, modelVersion, minEV: 0.03 });
  await base44.entities.Recommendation.create({
    recommendation_key: key, event_id: ev.id, value_signal_id: signal.id, prediction_id: prediction?.id,
    odds_snapshot_id: signal.odds_snapshot_id, market_key: signal.market_key, selection: signal.selection, line: signal.line,
    aposta_odds: signal.aposta_odds, model_probability: signal.model_probability, expected_value: signal.expected_value,
    probability_edge: signal.probability_edge, status: signal.status, confidence: signal.confidence,
    data_quality: signal.data_quality, aposta_event_url: ev.aposta_event_url, quality_adjusted_ev: signal.quality_adjusted_ev,
    created_at: now(), kickoff_utc: ev.kickoff_utc, published: eligible, unpublished_reasons: reasons,
    is_locked: false, settlement_status: "pending", stake_units: 1,
  });
  return 1;
}

// --- JOB: lock past events and capture closing lines ---
export async function lockPastEvents(base44) {
  const page = await base44.entities.Event.filter({ status: "scheduled" }, { limit: 200, sort: "kickoff_utc" });
  let locked = 0;
  for (const ev of page.items || []) {
    if (ev.is_locked || !ev.kickoff_utc || !(Date.parse(ev.kickoff_utc) < Date.now())) continue;
    await base44.entities.Event.update(ev.id, { is_locked: true });
    const pp = await base44.entities.Prediction.filter({ event_id: ev.id, is_locked: false }, { limit: 50 });
    for (const p of pp.items || []) await base44.entities.Prediction.update(p.id, { is_locked: true }).catch(() => {});
    await base44.entities.ValueSignal.updateMany({ event_id: ev.id, is_active: true }, { $set: { is_active: false } }).catch(() => {});
    await captureClosingLines(base44, ev);
    locked++;
  }
  return locked;
}

// Closing line = last snapshot observed before kickoff for every side of the
// market; CLV = taken odds × closing no-vig probability − 1.
export async function captureClosingLines(base44, ev) {
  const recs = await base44.entities.Recommendation.filter({ event_id: ev.id, is_locked: false }, { limit: 100 });
  const kickoffMs = Date.parse(ev.kickoff_utc);
  for (const r of recs.items || []) {
    const spec = SUPPORTED_MARKETS.find((s) => s.market_key === r.market_key && (s.line ?? null) === (r.line ?? null));
    const closing = {};
    if (spec) {
      for (const sel of spec.selections) {
        const snaps = await base44.entities.OddsSnapshot.filter({ event_id: ev.id, market_key: r.market_key, selection: sel }, { limit: 200, sort: "-observed_at" });
        const last = (snaps.items || []).find((s) => (s.line ?? null) === (r.line ?? null) && Date.parse(s.observed_at) < kickoffMs);
        if (last) closing[sel] = last.decimal_odds;
      }
    }
    const complete = spec && spec.selections.every((k) => closing[k] > 1);
    const nv = complete ? noVigNormalize(spec.selections.map((k) => impliedProbability(closing[k]))) : null;
    const closingNv = nv ? nv[spec.selections.indexOf(r.selection)] : null;
    await base44.entities.Recommendation.update(r.id, {
      is_locked: true, closing_odds: closing[r.selection] ?? null, closing_no_vig_probability: closingNv,
      clv: closingNv != null ? r.aposta_odds * closingNv - 1 : null,
    });
  }
}

// --- JOB: fetch results for mapped events from the fixture provider ---
const PROVIDER_STATUS_MAP = { PST: "postponed", CANC: "cancelled", ABD: "suspended", SUSP: "suspended", AWD: "finished_awarded", WO: "finished_awarded" };
export async function syncResults(base44, trigger = "manual") {
  return recordSyncRun(base44, "syncResults", trigger, async () => {
    const f = await footballMod();
    if (!f.isConfigured()) return { processed: 0, failed: 0, details: { note: "Football data provider not configured" } };
    const page = await base44.entities.Event.filter({ status: { $in: ["scheduled", "live", "suspended"] } }, { limit: 100, sort: "kickoff_utc" });
    let processed = 0, failed = 0;
    const review = [];
    for (const ev of page.items || []) {
      if (!ev.external_event_id || !(Date.parse(ev.kickoff_utc) + RESULT_CHECK_DELAY_MS < Date.now())) continue;
      try {
        const fx = await f.getFixture(ev.external_event_id);
        const evidence = { provider: fx.provider, external_event_id: fx.external_event_id, provider_status: fx.provider_status, retrieved_at: fx.retrieved_at };
        if (fx.result_confirmed) {
          await base44.entities.Event.update(ev.id, { status: "finished", home_score: fx.home_score, away_score: fx.away_score, result_evidence: evidence, is_locked: true });
        } else if (PROVIDER_STATUS_MAP[fx.provider_status] === "postponed" || PROVIDER_STATUS_MAP[fx.provider_status] === "cancelled") {
          await base44.entities.Event.update(ev.id, { status: PROVIDER_STATUS_MAP[fx.provider_status], result_evidence: evidence });
          await invalidateEventDerivations(base44, ev.id, `status_${PROVIDER_STATUS_MAP[fx.provider_status]}`);
        } else {
          // AET/PEN/AWD or still running: never settle automatically.
          review.push({ event_id: ev.id, provider_status: fx.provider_status });
        }
        processed++;
      } catch (e) { failed++; }
    }
    return { processed, failed, details: { needs_review: review.slice(0, 20) } };
  });
}

// --- JOB: settle finished matches (idempotent) ---
// Uses the LAST computed prediction made BEFORE kickoff — never a later one.
export async function settleFinishedMatches(base44, trigger = "manual") {
  return recordSyncRun(base44, "settleFinishedMatches", trigger, async () => {
    const page = await base44.entities.Event.filter({ status: { $in: ["finished", "postponed", "cancelled"] } }, { limit: 100 });
    let processed = 0, failed = 0;
    for (const ev of (page.items || []).filter((e) => !e.settled_at)) {
      try {
        if (ev.status === "finished") {
          if (outcome1x2(ev.home_score, ev.away_score) == null || !ev.result_evidence) continue; // unconfirmed score: skip
          await settlePredictions(base44, ev);
        }
        await settleRecommendations(base44, ev);
        await base44.entities.Event.update(ev.id, { settled_at: now() });
        processed++;
      } catch (e) { failed++; }
    }
    return { processed, failed };
  });
}

async function settlePredictions(base44, ev) {
  const preds = await base44.entities.Prediction.filter({ event_id: ev.id }, { limit: 50, sort: "-version" });
  const kickoffMs = Date.parse(ev.kickoff_utc);
  const pre = (preds.items || []).find((p) => p.computation_status === "computed" && Date.parse(p.predicted_at) < kickoffMs);
  if (!pre) return;
  for (const spec of SUPPORTED_MARKETS) {
    const probs = pre.market_probabilities?.[spec.probKey];
    if (!probs) continue;
    for (const sel of spec.selections) {
      const outcomeKey = `${pre.id}:${spec.market_key}:${spec.line ?? ""}:${sel}`;
      const dup = await base44.entities.PredictionOutcome.filter({ outcome_key: outcomeKey }, { limit: 1 });
      if (dup.items?.[0]) continue;
      await base44.entities.PredictionOutcome.create({
        outcome_key: outcomeKey, prediction_id: pre.id, event_id: ev.id, market_key: spec.market_key, line: spec.line, selection: sel,
        predicted_probability: probs[sel], result: settleSelection({ market_key: spec.market_key, selection: sel, line: spec.line }, ev.home_score, ev.away_score),
        settled_at: now(), home_score: ev.home_score, away_score: ev.away_score, verified: true, result_evidence: ev.result_evidence,
        predicted_at: pre.predicted_at, kickoff_utc: ev.kickoff_utc,
      });
    }
  }
}

async function settleRecommendations(base44, ev) {
  const recs = await base44.entities.Recommendation.filter({ event_id: ev.id, settlement_status: "pending" }, { limit: 100 });
  for (const r of recs.items || []) {
    const result = ev.status === "finished" ? settleSelection({ market_key: r.market_key, selection: r.selection, line: r.line }, ev.home_score, ev.away_score) : "void";
    if (!result) continue;
    await base44.entities.Recommendation.update(r.id, { settlement_status: result, profit_units: profitUnits(result, r.aposta_odds), settled_at: now(), is_locked: true });
  }
}

// --- Metrics (shared by job and performance page) ---
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

export async function calculateModelMetrics(base44, trigger = "manual") {
  return recordSyncRun(base44, "calculateModelMetrics", trigger, async () => {
    const metrics = await computePerformance(base44);
    const mp = await base44.entities.ModelVersion.filter({ is_production: true }, { limit: 1 });
    if (mp.items?.[0]) await base44.entities.ModelVersion.update(mp.items[0].id, { metrics: { ...metrics, computed_at: now() } });
    return { processed: 1, failed: 0, details: metrics };
  });
}

// --- JOB: provider health check ---
export async function providerHealthCheck(base44, trigger = "manual") {
  return recordSyncRun(base44, "providerHealthCheck", trigger, async () => {
    const a = await apostaMod();
    const f = await footballMod();
    const aposta = await a.apostaHealthCheck();
    const football = await f.testConnection();
    await upsertProviderHealth(base44, APOSTA_PROVIDER_NAME, aposta.status, aposta.error, aposta.latency_ms);
    await upsertProviderHealth(base44, "football_data", football.status, football.error, football.latency_ms);
    return { processed: 2, failed: 0, details: { aposta, football } };
  });
}

export async function upsertProviderHealth(base44, provider, status, error, latency = null) {
  const page = await base44.entities.ProviderHealth.filter({ provider }, { limit: 1 });
  const payload = {
    provider, status, error_message: error ? String(error).slice(0, 300) : null, latency_ms: latency,
    last_check_at: now(),
    ...(status === "healthy" ? { last_success_at: now() } : {}),
  };
  if (page.items?.[0]) await base44.entities.ProviderHealth.update(page.items[0].id, payload);
  else await base44.entities.ProviderHealth.create(payload);
}

// --- Orchestrated cycle (for a scheduler or the admin "Run cycle" button) ---
// Ordered so every step sees the output of the previous one. Each step is
// isolated: one failing step is recorded and the cycle continues.
export async function runScheduledCycle(base44, trigger = "scheduled") {
  const lease = await acquireLease(base44, "pipeline_cycle");
  if (!lease) {
    await base44.entities.SyncRun.create({ job_name: "runScheduledCycle", status: "skipped", started_at: now(), finished_at: now(), trigger, details: { reason: "lease_held" } }).catch(() => {});
    return { skipped: "lease_held" };
  }
  const steps = [
    ["health", () => providerHealthCheck(base44, trigger)],
    ["aposta_events", () => syncApostaEvents(base44, trigger)],
    ["match", () => matchExternalFixtures(base44, trigger)],
    ["football_data", () => syncFootballData(base44, null, trigger)],
    ["aposta_odds", () => syncApostaOdds(base44, null, trigger)],
    ["lock", () => lockPastEvents(base44)],
    ["predict", () => runPredictionModels(base44, null, "initial")],
    ["value", () => calculateValueSignals(base44, null, trigger)],
    ["results", () => syncResults(base44, trigger)],
    ["settle", () => settleFinishedMatches(base44, trigger)],
    ["metrics", () => calculateModelMetrics(base44, trigger)],
  ];
  const results = {};
  try {
    for (const [name, fn] of steps) {
      try { results[name] = await fn(); } catch (e) { results[name] = { error: String(e?.message || e).slice(0, 200) }; }
    }
  } finally {
    await lease.release();
  }
  return results;
}
