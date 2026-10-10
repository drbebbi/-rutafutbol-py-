// Data pipeline orchestration. Each job is observable via SyncRun records.
// All work uses the service-role client so admin-only entities are writable.
//
// BUG FIXES (this revision):
//   1. Field contract: upsertApostaEvent / importApostaEventManual now use
//      canonical home_team_name / away_team_name / competition_name.
//   2. Provider health: syncApostaOdds evaluates health before setting
//      success timestamps — unconfigured/degraded/offline never rejuvenates.
//   3. Snapshot integrity: source_timestamp, observed_at, market_status,
//      selection_status, snapshot_key, source_verified stored correctly.
//      Missing status is "unknown", not "open". Future timestamps rejected.
//      Snapshots are append-only. Market updates don't rejuvenate other
//      markets' selections.

import { normalizeApostaEvent, normalizeApostaMarket, validateApostaImport, APOSTA_PROVIDER_NAME } from "./apostaNormalizer.js";
import {
  normaliseName, resolveTeam, resolveCompetition, addTeamAlias, addCompetitionAlias, matchConfidence, rankFixtures, SAFE_THRESHOLD, AMBIGUOUS_THRESHOLD,
} from "./eventMatcher.js";
import { predictMatch, eloToLambda, ensembleLambdas, validateDistribution } from "../predictionEngine.js";
import {
  computeValueSignal, recommendationStatus, confidenceScore, confidenceLabel, qualityAdjustedEV, simpleEV, probabilityEdge, supportedMarket,
} from "../valueEngine.js";
import { impliedProbability, noVigNormalize, fairOdds } from "../oddsMath.js";
import { featuresFromRecords, featureLambdas, validateFeatures, MIN_TEAM_SAMPLE } from "@/lib/server/features.js";

// Lazy imports for modules that depend on base44:runtime (secrets).
// This keeps the pipeline testable without mocking the runtime.
let _aposta, _football;
const apostaMod = () => (_aposta ??= import("./apostaProvider.server.js"));
const footballMod = () => (_football ??= import("./footballDataProvider.server.js"));

const now = () => new Date().toISOString();

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

async function ensureTeam(base44, name, sport = "football", country = null) {
  if (!name) return null;
  const found = await resolveTeam(base44, name, sport);
  if (found) return found.team;
  return base44.entities.Team.create({ name, sport, country, elo_rating: 1500 });
}

async function ensureCompetition(base44, name, country = null, sport = "football") {
  if (!name) return null;
  const found = await resolveCompetition(base44, name, country);
  if (found) return found.competition;
  return base44.entities.Competition.create({ name, country, sport });
}

// Upsert an Aposta event (dedupe by aposta_event_id).
// Uses the CANONICAL field contract: home_team_name, away_team_name, competition_name.
// Validates the entire import before any DB write — an invalid import produces
// no half-finished records.
export async function upsertApostaEvent(base44, normalized, provenance = "unknown") {
  if (!normalized || !normalized.aposta_event_id) return null;

  // Validate before any DB write
  const validation = validateApostaImport(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid Aposta import: ${validation.errors.join(", ")}`);
  }

  const existing = await base44.entities.Event.filter(
    { aposta_event_id: normalized.aposta_event_id },
    { limit: 1 }
  );
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
  if (existing.items && existing.items.length > 0) {
    const ev = existing.items[0];
    return base44.entities.Event.update(ev.id, payload);
  }
  return base44.entities.Event.create({ ...payload, mapping_status: "unmatched" });
}

// Record an immutable odds snapshot AND update the live Selection record.
// source_timestamp and retrieval_timestamp are stored separately.
// market_status and selection_status are persisted from the provider response.
// Missing status is "unknown", never silently "open".
// Future source_timestamps (> 24h ahead) are rejected — observed_at stays null.
// Snapshots are append-only: existing snapshots are never updated or deleted.
export async function recordOddsSnapshot(
  base44, eventId, marketKey, selection, odds, line, marketId,
  marketStatus = "unknown", selectionStatus = "unknown", sourceTimestamp = null
) {
  const retrievalTs = now();

  // Reject implausibly future source timestamps — observed_at stays null (unknown)
  let observedAt = null;
  if (sourceTimestamp) {
    const ts = Date.parse(sourceTimestamp);
    if (Number.isFinite(ts) && ts <= Date.now() + 24 * 60 * 60 * 1000) {
      observedAt = sourceTimestamp;
    }
  }

  const snapshotKey = `${eventId}:${marketId}:${selection}:${line ?? ""}:${observedAt || retrievalTs}`;

  // Immutable snapshot — append only, never update historical odds
  await base44.entities.OddsSnapshot.create({
    event_id: eventId,
    market_id: marketId,
    market_key: marketKey,
    selection,
    line: line ?? null,
    bookmaker: APOSTA_PROVIDER_NAME,
    decimal_odds: odds,
    market_status: marketStatus,
    selection_status: selectionStatus,
    retrieval_timestamp: retrievalTs,
    source_timestamp: observedAt,
    observed_at: observedAt,
    implied_probability: impliedProbability(odds),
    snapshot_key: snapshotKey,
    source_verified: false,
  });

  // Update live selection (track open/high/low) — this is the current state,
  // not a snapshot. Only updated when a new snapshot is successfully recorded.
  const selPage = await base44.entities.Selection.filter(
    { market_id: marketId, selection },
    { limit: 1 }
  );
  if (selPage.items && selPage.items.length > 0) {
    const s = selPage.items[0];
    const opening = s.opening_odds ?? odds;
    const highest = Math.max(s.highest_odds ?? odds, odds);
    const lowest = s.lowest_odds == null ? odds : Math.min(s.lowest_odds, odds);
    await base44.entities.Selection.update(s.id, {
      current_odds: odds,
      opening_odds: opening,
      highest_odds: highest,
      lowest_odds: lowest,
      odds_updated_at: retrievalTs,
      last_success_at: retrievalTs,
      status: selectionStatus,
      is_suspended: selectionStatus === "suspended",
      current_snapshot_id: null, // not retrivable in mock; set in production
    });
  } else {
    await base44.entities.Selection.create({
      market_id: marketId,
      event_id: eventId,
      selection,
      current_odds: odds,
      opening_odds: odds,
      highest_odds: odds,
      lowest_odds: odds,
      odds_updated_at: retrievalTs,
      last_success_at: retrievalTs,
      line: line ?? null,
      status: selectionStatus,
      is_suspended: selectionStatus === "suspended",
    });
  }
}

// Ensure a Market record exists for an event + market key.
// Stores period, provider IDs, and status from the normalized market.
export async function ensureMarket(
  base44, eventId, marketKey, marketName, line, tier = 1,
  providerMarketId = null, status = "unknown", period = "full_time", providerMarketName = null
) {
  const page = await base44.entities.Market.filter({ event_id: eventId, market_key: marketKey, line: line ?? null }, { limit: 1 });
  if (page.items && page.items.length > 0) {
    const existing = page.items[0];
    // Update status if it changed (market is live state, not a snapshot)
    if (existing.status !== status) {
      await base44.entities.Market.update(existing.id, { status, last_success_at: now() }).catch(() => {});
    }
    return existing;
  }
  return base44.entities.Market.create({
    event_id: eventId, market_key: marketKey, market_name: marketName, line, tier,
    provider_market_id: providerMarketId, status, period, provider_market_name: providerMarketName,
  });
}

// --- JOB: sync Aposta events ---
export async function syncApostaEvents(base44, trigger = "manual") {
  return recordSyncRun(base44, "syncApostaEvents", trigger, async () => {
    const a = await apostaMod();
    const { events, health } = await a.fetchApostaEvents();
    await upsertProviderHealth(base44, APOSTA_PROVIDER_NAME, health.status, health.error);
    let processed = 0, failed = 0;
    for (const ev of events) {
      try {
        await upsertApostaEvent(base44, ev, "aposta_api");
        processed++;
      } catch (e) { failed++; }
    }
    return { processed, failed, details: { health } };
  });
}

// --- JOB: sync Aposta odds for an event (or all scheduled) ---
// Evaluates provider health before setting success timestamps.
// Unconfigured/degraded/offline never rejuvenates existing odds.
// A healthy response with no markets marks previously-open markets as missing.
export async function syncApostaOdds(base44, eventId = null, trigger = "manual") {
  return recordSyncRun(base44, "syncApostaOdds", trigger, async () => {
    const a = await apostaMod();
    let events = [];
    if (eventId) {
      const ev = await base44.entities.Event.get(eventId).catch(() => null);
      if (ev) events = [ev];
    } else {
      const page = await base44.entities.Event.filter({ status: "scheduled" }, { limit: 50 });
      events = page.items || [];
    }
    let processed = 0, failed = 0;
    for (const ev of events) {
      const attemptTs = now();
      await base44.entities.Event.update(ev.id, { last_odds_attempt_at: attemptTs }).catch(() => {});
      try {
        const { markets, health } = await a.fetchApostaOdds(ev.aposta_event_id);

        // Evaluate health — only "healthy" gets a success timestamp
        if (health.status !== "healthy") {
          // Failed fetch: preserve old data, record error, no success timestamp
          await base44.entities.Event.update(ev.id, {
            odds_fetch_status: `${health.status}: ${health.error || "unknown error"}`,
          }).catch(() => {});
          failed++;
          continue;
        }

        // Healthy response — process markets
        for (const m of markets) {
          if (!supportedMarket(m.market_key, m.line)) continue;
          const market = await ensureMarket(
            base44, ev.id, m.market_key, m.market_name, m.line, m.tier || 1,
            m.provider_market_id, m.status, m.period, m.provider_market_name
          );
          for (const sel of m.selections) {
            if (sel.odds && Number.isFinite(sel.odds) && sel.odds > 1) {
              await recordOddsSnapshot(
                base44, ev.id, m.market_key, sel.selection, sel.odds,
                sel.line ?? m.line, market.id, m.status, sel.status, m.source_timestamp
              );
            }
          }
        }

        // On a complete healthy response, mark previously-open markets not
        // in the response as no longer available.
        const responseKeys = new Set(markets.map((m) => `${m.market_key}:${m.line ?? ""}`));
        const existingPage = await base44.entities.Market.filter({ event_id: ev.id }, { limit: 50 });
        for (const m of existingPage.items || []) {
          const key = `${m.market_key}:${m.line ?? ""}`;
          if (!responseKeys.has(key) && (m.status === "open" || m.status === "unknown")) {
            await base44.entities.Market.update(m.id, { status: "missing" }).catch(() => {});
          }
        }

        const successTs = now();
        await base44.entities.Event.update(ev.id, {
          last_odds_sync_at: successTs,
          last_odds_success_at: successTs,
          odds_fetch_status: "ok",
        });
        processed++;
      } catch (e) {
        // Network error or unexpected exception — preserve old data
        await base44.entities.Event.update(ev.id, {
          odds_fetch_status: String(e?.message || e).slice(0, 200),
        }).catch(() => {});
        failed++;
      }
    }
    return { processed, failed };
  });
}

// --- JOB: match external fixtures ---
export async function matchExternalFixtures(base44, trigger = "manual") {
  return recordSyncRun(base44, "matchExternalFixtures", trigger, async () => {
    const f = await footballMod();
    if (!f.isConfigured()) return { processed: 0, failed: 0, details: { note: "Football data provider not configured" } };
    const page = await base44.entities.Event.filter({ mapping_status: "unmatched" }, { limit: 50 });
    let processed = 0, failed = 0;
    for (const ev of page.items || []) {
      try {
        const date = (ev.kickoff_utc || now()).slice(0, 10);
        const { fixtures } = await f.getFixturesByDate(date);
        const { best, confirmed, gap, reason } = rankFixtures(ev, fixtures);
        if (confirmed && best.confidence >= SAFE_THRESHOLD) {
          const extId = best.fixture.external_event_id;
          await base44.entities.EventMapping.create({
            event_id: ev.id, provider: "football_data", external_event_id: String(extId),
            confidence: best.confidence, match_method: "auto", match_factors: best.factors, is_confirmed: true,
          });
          await base44.entities.Event.update(ev.id, {
            mapping_status: "matched", mapping_confidence: best.confidence, external_event_id: String(extId),
          });
        } else if (best && best.confidence >= AMBIGUOUS_THRESHOLD) {
          await base44.entities.Event.update(ev.id, { mapping_status: "ambiguous", mapping_confidence: best.confidence });
        }
        processed++;
      } catch (e) { failed++; }
    }
    return { processed, failed };
  });
}

// --- JOB: sync football data (stats, standings) for an event ---
export async function syncFootballData(base44, eventId, trigger = "manual") {
  return recordSyncRun(base44, "syncFootballData", trigger, async () => {
    const f = await footballMod();
    const ev = await base44.entities.Event.get(eventId).catch(() => null);
    if (!ev) return { processed: 0, failed: 1 };
    if (!f.isConfigured()) return { processed: 0, failed: 0, details: { note: "not configured" } };
    let processed = 0, failed = 0;
    try {
      for (const teamId of [ev.home_team_id, ev.away_team_id].filter(Boolean)) {
        const team = await base44.entities.Team.get(teamId).catch(() => null);
        const extId = team?.external_ids?.football_data_id;
        if (extId) {
          const { matches } = await f.getTeamLastMatches(extId, 10);
          for (const m of matches) {
            await base44.entities.TeamMatchStat.create({
              team_id: teamId, event_id: ev.id, is_home: m.is_home,
              goals: m.goals, goals_conceded: m.goals_conceded,
              played_at: m.played_at, source: m.source,
              known_at: m.known_at, retrieved_at: m.retrieved_at,
              external_fixture_id: m.external_fixture_id,
              external_team_id: m.external_team_id,
              external_opponent_id: m.external_opponent_id,
              data_quality: m.data_quality, verified: m.verified,
            });
          }
        }
      }
      await base44.entities.Event.update(ev.id, { last_data_sync_at: now() });
      processed = 1;
    } catch (e) { failed = 1; }
    return { processed, failed };
  });
}

// --- JOB: update injuries and lineups ---
export async function updateInjuriesAndLineups(base44, eventId, trigger = "manual") {
  return recordSyncRun(base44, "updateInjuriesAndLineups", trigger, async () => {
    const f = await footballMod();
    const ev = await base44.entities.Event.get(eventId).catch(() => null);
    if (!ev || !ev.external_event_id) return { processed: 0, failed: 0, details: { note: "no external mapping" } };
    let processed = 0, failed = 0;
    try {
      const { lineups } = await f.getLineups(ev.external_event_id);
      let confirmed = false;
      for (const lp of lineups) {
        const team = await base44.entities.Team.filter({ "external_ids.football_data_id": lp.external_team_id }, { limit: 1 }).catch(() => ({ items: [] }));
        const teamId = team.items?.[0]?.id || (lp.external_team_id === ev.home_team_id ? ev.home_team_id : ev.away_team_id);
        const status = lp.confirmed ? "confirmed" : "expected";
        if (lp.confirmed) confirmed = true;
        await base44.entities.Lineup.create({
          event_id: eventId, team_id: teamId, is_home: teamId === ev.home_team_id,
          status, formation: lp.formation, players: lp.players || [], source: lp.source || "football_data",
          retrieved_at: lp.retrieved_at,
        });
      }
      const { injuries } = await f.getInjuries(ev.external_event_id);
      for (const inj of injuries) {
        const team = await base44.entities.Team.filter({ "external_ids.football_data_id": inj.external_team_id }, { limit: 1 }).catch(() => ({ items: [] }));
        const teamId = team.items?.[0]?.id || inj.external_team_id;
        await base44.entities.Injury.create({
          team_id: teamId, event_id: eventId, player_name: inj.player_name,
          reason: inj.reason, status: inj.status, source: inj.source || "football_data",
          retrieved_at: inj.retrieved_at,
        });
      }
      await base44.entities.Event.update(ev.id, { lineup_status: confirmed ? "confirmed" : "expected" });
      processed = 1;
    } catch (e) { failed = 1; }
    return { processed, failed };
  });
}

// --- Feature generation: delegated to the shared features module ---
export async function generateFeatures(base44, eventId) {
  const ev = await base44.entities.Event.get(eventId).catch(() => null);
  if (!ev) return null;
  const asOf = new Date().toISOString();
  const kickoff = ev.kickoff_utc || asOf;
  const records = {};
  for (const [side, teamId] of [["home", ev.home_team_id], ["away", ev.away_team_id]]) {
    if (!teamId) { records[side] = []; continue; }
    const page = await base44.entities.TeamMatchStat.filter({ team_id: teamId }, { limit: 20, sort: "-played_at" });
    records[side] = page.items || [];
  }
  return featuresFromRecords(records.home, records.away, asOf, kickoff);
}

// --- Data quality dimensions for an event ---
export async function computeDataQuality(base44, event) {
  const oddsFresh = isOddsFresh(event.last_odds_sync_at);
  const mappingConfident = (event.mapping_confidence ?? 0) >= SAFE_THRESHOLD;
  const statsPage = await base44.entities.TeamMatchStat.filter({ event_id: event.id }, { limit: 1 });
  const hasStats = (statsPage.items || []).length > 0;
  const lineupPage = await base44.entities.Lineup.filter({ event_id: event.id }, { limit: 1 });
  const lineup = (lineupPage.items || [])[0];
  return {
    fixture_mapping: mappingConfident ? "good" : event.mapping_status === "ambiguous" ? "acceptable" : "missing",
    odds_freshness: oddsFresh ? "fresh" : event.last_odds_sync_at ? "stale" : "missing",
    stats_completeness: hasStats ? "partial" : "missing",
    lineup_quality: lineup?.status || "not_confirmed",
    injury_quality: "missing",
    model_sample_quality: "limited",
  };
}

function isOddsFresh(lastSync) {
  if (!lastSync) return false;
  return Date.now() - new Date(lastSync).getTime() < 30 * 60 * 1000; // 30 min
}

// --- JOB: run prediction models (versioned, immutable) ---
export async function runPredictionModels(base44, eventId, triggerSource = "initial") {
  return recordSyncRun(base44, "runPredictionModels", "event", async () => {
    const ev = await base44.entities.Event.get(eventId).catch(() => null);
    if (!ev) return { processed: 0, failed: 1 };
    if (ev.is_locked) return { processed: 0, failed: 0, details: { note: "event locked (kickoff passed)" } };

    let modelVersion = await ensureProductionModel(base44);

    const homeTeam = ev.home_team_id ? await base44.entities.Team.get(ev.home_team_id).catch(() => null) : null;
    const awayTeam = ev.away_team_id ? await base44.entities.Team.get(ev.away_team_id).catch(() => null) : null;
    const features = await generateFeatures(base44, eventId);

    const eloLambdas = eloToLambda(homeTeam?.elo_rating ?? 1500, awayTeam?.elo_rating ?? 1500);
    let featLambdas = null;
    const featValidation = validateFeatures(features);
    if (featValidation.valid) {
      try { featLambdas = featureLambdas(features); } catch { featLambdas = null; }
    }
    const goalLambdas = { lambdaHome: eloLambdas.lambdaHome, lambdaAway: eloLambdas.lambdaAway };
    const ensemble = featLambdas ? ensembleLambdas(goalLambdas, eloLambdas, featLambdas) : goalLambdas;

    const pred = predictMatch(ensemble.lambdaHome, ensemble.lambdaAway);
    const probs = pred.x1x2;

    const dq = await computeDataQuality(base44, ev);
    const conf = confidenceScore({
      modelAgreement: 0.7,
      calibrationQuality: 0.6,
      featureCompleteness: validateFeatures(features).valid ? 0.8 : 0.4,
      oddsFreshness: dq.odds_freshness === "fresh" ? 1 : dq.odds_freshness === "stale" ? 0.4 : 0,
      mappingConfidence: (ev.mapping_confidence ?? 0),
      lineupStatus: dq.lineup_quality === "confirmed" ? 1 : dq.lineup_quality === "expected" ? 0.5 : 0.2,
      sampleSize: Math.min(1, ((features?.home?.sample_size ?? 0) + (features?.away?.sample_size ?? 0)) / 12),
      modelUncertainty: 0.6,
    });

    const existing = await base44.entities.Prediction.filter({ event_id: eventId }, { limit: 1, sort: "-version" });
    const nextVersion = (existing.items?.[0]?.version || 0) + 1;
    if (existing.items?.[0]) {
      await base44.entities.Prediction.update(existing.items[0].id, { superseded_by: "pending" }).catch(() => {});
    }

    const prediction = await base44.entities.Prediction.create({
      event_id: eventId,
      model_version_id: modelVersion.id,
      version: nextVersion,
      trigger: triggerSource,
      market_key: "1x2",
      probabilities: probs,
      lambda_home: ensemble.lambdaHome,
      lambda_away: ensemble.lambdaAway,
      expected_goals_home: pred.expectedGoalsHome,
      expected_goals_away: pred.expectedGoalsAway,
      score_distribution: pred.correctScore,
      component_contributions: { goal_model: goalLambdas, elo: eloLambdas, feature: featLambdas, ensemble },
      feature_snapshot: features,
      data_quality: dq,
      confidence: confidenceLabel(conf),
      confidence_score: conf,
      predicted_at: now(),
      as_of: new Date().toISOString(),
      is_locked: false,
      calibration_status: "RAW",
      rho: 0,
      tail_mass: pred.tail_mass,
    });

    if (existing.items?.[0]) {
      await base44.entities.Prediction.update(existing.items[0].id, { superseded_by: prediction.id }).catch(() => {});
    }

    return { processed: 1, failed: 0, details: { prediction_id: prediction.id, version: nextVersion } };
  });
}

async function ensureProductionModel(base44) {
  const page = await base44.entities.Model.filter({ is_active: true }, { limit: 1 });
  let model = page.items?.[0];
  if (!model) model = await base44.entities.Model.create({ name: "Football Ensemble v1", sport: "football", type: "ensemble", is_active: true });
  const vp = await base44.entities.ModelVersion.filter({ model_id: model.id, is_production: true }, { limit: 1 });
  if (vp.items?.[0]) return vp.items[0];
  return base44.entities.ModelVersion.create({
    model_id: model.id, version_label: "1.0.0", components: ["poisson_dixon_coles", "elo", "feature_statistical"],
    calibration_method: "sigmoid", is_production: true,
  });
}

// --- JOB: calculate value signals for an event ---
export async function calculateValueSignals(base44, eventId, trigger = "manual") {
  return recordSyncRun(base44, "calculateValueSignals", trigger, async () => {
    const ev = await base44.entities.Event.get(eventId).catch(() => null);
    if (!ev) return { processed: 0, failed: 1 };
    const predPage = await base44.entities.Prediction.filter({ event_id: eventId }, { limit: 1, sort: "-version" });
    const prediction = predPage.items?.[0];
    if (!prediction) return { processed: 0, failed: 0, details: { note: "no prediction" } };

    const signals = [];
    // 1X2
    const m1x2 = await base44.entities.Market.filter({ event_id: eventId, market_key: "1x2" }, { limit: 1 });
    if (m1x2.items?.[0]) {
      const sels = await base44.entities.Selection.filter({ market_id: m1x2.items[0].id }, { limit: 10 });
      const oddsMap = {};
      for (const s of sels.items || []) oddsMap[s.selection] = s.current_odds;
      const marketProbs = ["home", "draw", "away"].map((k) => (oddsMap[k] ? impliedProbability(oddsMap[k]) : 0));
      const noVig = noVigNormalize(marketProbs);
      const probKeys = ["home", "draw", "away"];
      for (let i = 0; i < 3; i++) {
        const odds = oddsMap[probKeys[i]];
        if (!odds) continue;
        const modelProb = prediction.probabilities[probKeys[i]];
        const noVigProb = noVig[i];
        const ev_val = simpleEV(modelProb, odds);
        const edge = probabilityEdge(modelProb, noVigProb);
        const dq = prediction.data_quality || {};
        const status = recommendationStatus({
          ev: ev_val, dataQuality: dq.stats_completeness, oddsFresh: dq.odds_freshness === "fresh",
          mappingConfident: (ev.mapping_confidence ?? 0) >= SAFE_THRESHOLD, sampleMet: (prediction.feature_snapshot?.home?.sample_size ?? 0) >= 3,
          marketOpen: true,
        });
        const conf = prediction.confidence_score ?? 0.5;
        signals.push({
          event_id: eventId, prediction_id: prediction.id, market_key: "1x2", selection: probKeys[i],
          aposta_odds: odds, aposta_no_vig_probability: noVigProb, model_probability: modelProb,
          probability_edge: edge, expected_value: ev_val, fair_odds: fairOdds(modelProb),
          status, data_quality: dq, confidence: prediction.confidence,
          quality_adjusted_ev: qualityAdjustedEV(ev_val, conf), calculated_at: now(),
        });
      }
    }
    // Over/Under 2.5
    const mOU = await base44.entities.Market.filter({ event_id: eventId, market_key: "over_under_goals", line: 2.5 }, { limit: 1 });
    if (mOU.items?.[0]) {
      const sels = await base44.entities.Selection.filter({ market_id: mOU.items[0].id }, { limit: 10 });
      const oddsMap = {};
      for (const s of sels.items || []) oddsMap[s.selection] = s.current_odds;
      const pred = predictMatch(prediction.lambda_home, prediction.lambda_away);
      for (const [sel, prob] of [["over", pred.overUnder25.over], ["under", pred.overUnder25.under]]) {
        const odds = oddsMap[sel];
        if (!odds) continue;
        const ev_val = simpleEV(prob, odds);
        const noVigProb = noVigNormalize([impliedProbability(oddsMap.over || 0), impliedProbability(oddsMap.under || 0)])[sel === "over" ? 0 : 1];
        signals.push({
          event_id: eventId, prediction_id: prediction.id, market_key: "over_under_goals", selection: sel, line: 2.5,
          aposta_odds: odds, aposta_no_vig_probability: noVigProb, model_probability: prob,
          probability_edge: probabilityEdge(prob, noVigProb), expected_value: ev_val, fair_odds: fairOdds(prob),
          status: recommendationStatus({ ev: ev_val, dataQuality: prediction.data_quality?.stats_completeness, oddsFresh: prediction.data_quality?.odds_freshness === "fresh", mappingConfident: (ev.mapping_confidence ?? 0) >= SAFE_THRESHOLD, sampleMet: true, marketOpen: true }),
          data_quality: prediction.data_quality, confidence: prediction.confidence,
          quality_adjusted_ev: qualityAdjustedEV(ev_val, prediction.confidence_score ?? 0.5), calculated_at: now(),
        });
      }
    }
    // BTTS
    const mBTTS = await base44.entities.Market.filter({ event_id: eventId, market_key: "btts" }, { limit: 1 });
    if (mBTTS.items?.[0]) {
      const sels = await base44.entities.Selection.filter({ market_id: mBTTS.items[0].id }, { limit: 10 });
      const oddsMap = {};
      for (const s of sels.items || []) oddsMap[s.selection] = s.current_odds;
      const pred = predictMatch(prediction.lambda_home, prediction.lambda_away);
      for (const [sel, prob] of [["yes", pred.btts.yes], ["no", pred.btts.no]]) {
        const odds = oddsMap[sel];
        if (!odds) continue;
        const ev_val = simpleEV(prob, odds);
        signals.push({
          event_id: eventId, prediction_id: prediction.id, market_key: "btts", selection: sel,
          aposta_odds: odds, aposta_no_vig_probability: noVigNormalize([impliedProbability(oddsMap.yes || 0), impliedProbability(oddsMap.no || 0)])[sel === "yes" ? 0 : 1],
          model_probability: prob, probability_edge: probabilityEdge(prob, noVigNormalize([impliedProbability(oddsMap.yes || 0), impliedProbability(oddsMap.no || 0)])[sel === "yes" ? 0 : 1]),
          expected_value: ev_val, fair_odds: fairOdds(prob),
          status: recommendationStatus({ ev: ev_val, dataQuality: prediction.data_quality?.stats_completeness, oddsFresh: prediction.data_quality?.odds_freshness === "fresh", mappingConfident: (ev.mapping_confidence ?? 0) >= SAFE_THRESHOLD, sampleMet: true, marketOpen: true }),
          data_quality: prediction.data_quality, confidence: prediction.confidence,
          quality_adjusted_ev: qualityAdjustedEV(ev_val, prediction.confidence_score ?? 0.5), calculated_at: now(),
        });
      }
    }

    // deactivate old signals, write new ones
    await base44.entities.ValueSignal.updateMany({ event_id: eventId }, { $set: { is_active: false } }).catch(() => {});
    let processed = 0, failed = 0;
    for (const sig of signals) {
      try {
        await base44.entities.ValueSignal.create(sig);
        processed++;
      } catch (e) { failed++; }
    }
    return { processed, failed };
  });
}

// --- JOB: settle finished matches ---
export async function settleFinishedMatches(base44, trigger = "manual") {
  return recordSyncRun(base44, "settleFinishedMatches", trigger, async () => {
    const page = await base44.entities.Event.filter({ status: "finished" }, { limit: 50 });
    let processed = 0, failed = 0;
    for (const ev of page.items || []) {
      try {
        const predPage = await base44.entities.Prediction.filter({ event_id: ev.id }, { limit: 1, sort: "-version" });
        const pred = predPage.items?.[0];
        if (pred) {
          const result = ev.home_score > ev.away_score ? "home" : ev.home_score === ev.away_score ? "draw" : "away";
          const actual = result;
          for (const sel of ["home", "draw", "away"]) {
            await base44.entities.PredictionOutcome.create({
              prediction_id: pred.id, event_id: ev.id, market_key: "1x2", selection: sel,
              predicted_probability: pred.probabilities[sel], result: sel === actual ? "win" : "loss",
              settled_at: now(), home_score: ev.home_score, away_score: ev.away_score,
            });
          }
        }
        await base44.entities.Event.update(ev.id, { is_locked: true }).catch(() => {});
        processed++;
      } catch (e) { failed++; }
    }
    return { processed, failed };
  });
}

// --- JOB: calculate model metrics ---
export async function calculateModelMetrics(base44, trigger = "manual") {
  return recordSyncRun(base44, "calculateModelMetrics", trigger, async () => {
    const page = await base44.entities.PredictionOutcome.filter({ result: { $in: ["win", "loss"] } }, { limit: 500 });
    const outcomes = page.items || [];
    let logLoss = 0, brier = 0, correct = 0;
    for (const o of outcomes) {
      const p = Math.min(1, Math.max(0, o.predicted_probability));
      const actual = o.result === "win" ? 1 : 0;
      logLoss += -(actual * Math.log(p + 1e-9) + (1 - actual) * Math.log(1 - p + 1e-9));
      brier += (p - actual) ** 2;
      if ((o.result === "win" && p >= 0.5) || (o.result === "loss" && p < 0.5)) correct++;
    }
    const n = outcomes.length || 1;
    const metrics = { log_loss: logLoss / n, brier_score: brier / n, accuracy: correct / n, sample_size: outcomes.length };
    const mp = await base44.entities.ModelVersion.filter({ is_production: true }, { limit: 1 });
    if (mp.items?.[0]) await base44.entities.ModelVersion.update(mp.items[0].id, { metrics });
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
    provider, status, error_message: error || null, latency_ms: latency,
    last_check_at: now(),
    ...(status === "healthy" ? { last_success_at: now() } : {}),
  };
  if (page.items?.[0]) await base44.entities.ProviderHealth.update(page.items[0].id, payload);
  else await base44.entities.ProviderHealth.create(payload);
}

// --- Manual Aposta event import (admin) ---
// Validates the entire payload before any DB write.
// Uses canonical field names (home_team_name, away_team_name, competition_name).
// Sets provenance to "manual_import" — distinct from verified automated sync.
// Does NOT auto-run predictions or value signals — the admin must run the
// next pipeline steps (match fixtures, sync stats, run predictions) manually.
export async function importApostaEventManual(base44, rawPayload) {
  const normalized = normalizeApostaEvent(rawPayload);
  const validation = validateApostaImport(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid Aposta event payload: ${validation.errors.join(", ")}`);
  }

  const ev = await upsertApostaEvent(base44, normalized, "manual_import");

  // Ingest markets + odds as immutable snapshots
  for (const m of normalized.markets) {
    if (!supportedMarket(m.market_key, m.line)) continue;
    const market = await ensureMarket(
      base44, ev.id, m.market_key, m.market_name, m.line, m.tier || 1,
      m.provider_market_id, m.status, m.period, m.provider_market_name
    );
    for (const sel of m.selections) {
      if (sel.odds && Number.isFinite(sel.odds) && sel.odds > 1) {
        await recordOddsSnapshot(
          base44, ev.id, m.market_key, sel.selection, sel.odds,
          sel.line ?? m.line, market.id, m.status, sel.status, m.source_timestamp
        );
      }
    }
  }

  const ts = now();
  await base44.entities.Event.update(ev.id, {
    last_odds_sync_at: ts,
    last_odds_success_at: ts,
    odds_fetch_status: "ok",
  });

  return ev;
}

// Lock events whose kickoff has passed (pre-match predictions become immutable).
export async function lockPastEvents(base44) {
  const page = await base44.entities.Event.filter({ status: "scheduled", is_locked: false }, { limit: 100 });
  let locked = 0;
  for (const ev of page.items || []) {
    if (ev.kickoff_utc && new Date(ev.kickoff_utc).getTime() < Date.now()) {
      await base44.entities.Event.update(ev.id, { is_locked: true }).catch(() => {});
      const pp = await base44.entities.Prediction.filter({ event_id: ev.id, is_locked: false }, { limit: 20 });
      for (const p of pp.items || []) await base44.entities.Prediction.update(p.id, { is_locked: true }).catch(() => {});
      locked++;
    }
  }
  return locked;
}