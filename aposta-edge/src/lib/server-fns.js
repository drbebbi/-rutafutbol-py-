// Server functions exposed to the frontend. All require a signed-in user;
// admin-only actions additionally check the role.
// Server-only modules (pipeline, providers) are loaded lazily so they never
// enter the client bundle — handlers run server-side only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { addTeamAlias, addCompetitionAlias, normaliseName } from "@/lib/server/eventMatcher.js";
import { isDemoEvent, hasVerifiableProvenance, isOddsFresh, kickoffPassed, mappingConfident, signalEligibility, describeProvenance } from "@/lib/server/provenance.js";

let _pipe, _aposta, _football;
const pipe = () => (_pipe ??= import("@/lib/server/syncPipeline.server.js"));
const apostaMod = () => (_aposta ??= import("@/lib/server/apostaProvider.server.js"));
const footballMod = () => (_football ??= import("@/lib/server/footballDataProvider.server.js"));

const admin = (context) => {
  if (context.user?.role !== "admin") {
    throw Object.assign(new Error("Admin only"), { status: 403 });
  }
};

// ---------- Reads (loaders) ----------
export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ day: z.string().optional(), status: z.string().optional(), limit: z.number().optional() }).optional())
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const query = {};
    if (data?.status) query.status = data.status;
    if (data?.day) {
      const d = data.day;
      const next = new Date(d + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      query.kickoff_utc = { $gte: d + "T00:00:00Z", $lt: next.toISOString() };
    }
    const page = await b.entities.Event.filter(query, { sort: "kickoff_utc", limit: data?.limit || 60 });
    // Exclude demo events and events whose kickoff has already passed from the
    // upcoming list. Historical/finished events stay visible on their detail page.
    const now = Date.now();
    return (page.items || []).filter((e) => !isDemoEvent(e) && (e.status === "live" || e.status === "finished" || !kickoffPassed(e, now)));
  });

export const getEventDetail = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const event = await b.entities.Event.get(data.id).catch(() => null);
    if (!event) return null;
    const [markets, predictions, injuries, lineups, stats, snapshots] = await Promise.all([
      b.entities.Market.filter({ event_id: data.id }, { limit: 50 }),
      b.entities.Prediction.filter({ event_id: data.id }, { limit: 10, sort: "-version" }),
      b.entities.Injury.filter({ event_id: data.id }, { limit: 20 }),
      b.entities.Lineup.filter({ event_id: data.id }, { limit: 2 }),
      b.entities.TeamMatchStat.filter({ event_id: data.id }, { limit: 20 }),
      b.entities.OddsSnapshot.filter({ event_id: data.id }, { limit: 100, sort: "-retrieval_timestamp" }),
    ]);
    const marketIds = (markets.items || []).map((m) => m.id);
    const selections = marketIds.length
      ? await b.entities.Selection.filter({ market_id: { $in: marketIds } }, { limit: 200 })
      : { items: [] };
    const signals = await b.entities.ValueSignal.filter({ event_id: data.id, is_active: true }, { limit: 30 });
    // Recompute odds freshness at read time — stored labels may be stale.
    const now = Date.now();
    const enrichedSignals = (signals.items || []).map((s) => ({
      ...s,
      odds_fresh: isOddsFresh(event.last_odds_sync_at, now),
    }));
    const pred = (predictions.items || [])[0];
    return {
      event,
      provenance: describeProvenance(event),
      odds_fresh: isOddsFresh(event.last_odds_sync_at, now),
      kickoff_passed: kickoffPassed(event, now),
      mapping_confident: mappingConfident(event),
      is_demo: isDemoEvent(event),
      verifiable: hasVerifiableProvenance(event),
      prediction_computed: pred ? pred.feature_snapshot != null : false,
      markets: markets.items || [],
      selections: selections.items || [],
      predictions: predictions.items || [],
      injuries: injuries.items || [],
      lineups: lineups.items || [],
      stats: stats.items || [],
      snapshots: snapshots.items || [],
      signals: enrichedSignals,
    };
  });

export const listRecommendations = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ limit: z.number().optional() }).optional())
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    // Shared provenance-gated filtering — same rules as the Edge Analyst AI.
    const { filterEligibleSignals } = await import("@/lib/server/signalFilter.js");
    return await filterEligibleSignals(b, { limit: data?.limit || 50 });
  });

export const getPerformanceMetrics = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const [outcomesPage, modelPage, recsPage] = await Promise.all([
      b.entities.PredictionOutcome.filter({ result: { $in: ["win", "loss"] } }, { limit: 1000 }),
      b.entities.ModelVersion.filter({ is_production: true }, { limit: 1 }),
      b.entities.Recommendation.filter({ settlement_status: { $in: ["win", "loss"] } }, { limit: 1000 }),
    ]);
    const outcomes = outcomesPage.items || [];
    const recs = recsPage.items || [];
    let logLoss = 0, brier = 0, correct = 0;
    for (const o of outcomes) {
      const p = Math.min(1, Math.max(0, o.predicted_probability));
      const actual = o.result === "win" ? 1 : 0;
      logLoss += -(actual * Math.log(p + 1e-9) + (1 - actual) * Math.log(1 - p + 1e-9));
      brier += (p - actual) ** 2;
      if ((o.result === "win" && p >= 0.5) || (o.result === "loss" && p < 0.5)) correct++;
    }
    const n = outcomes.length || 1;
    let profit = 0, wins = 0, losses = 0, staked = 0;
    for (const r of recs) {
      staked += 1;
      if (r.settlement_status === "win") { wins++; profit += (r.aposta_odds - 1); }
      else if (r.settlement_status === "loss") { losses++; profit -= 1; }
    }
    return {
      model_version: modelPage.items?.[0]?.version_label || "—",
      sample_size: outcomes.length,
      log_loss: logLoss / n,
      brier_score: brier / n,
      accuracy: correct / n,
      bets: recs.length,
      wins, losses,
      roi: staked > 0 ? profit / staked : 0,
      yield: profit,
      avg_odds: recs.length ? recs.reduce((a, r) => a + (r.aposta_odds || 0), 0) / recs.length : null,
    };
  });

// ---------- User settings ----------
export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const page = await b.entities.UserSettings.filter({}, { limit: 1 });
    if (page.items?.[0]) return page.items[0];
    return await b.entities.UserSettings.create({ timezone: "America/Asuncion", value_profile: "balanced", min_ev: 3 });
  });

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    id: z.string().optional(),
    timezone: z.string().optional(),
    value_profile: z.enum(["conservative", "balanced", "aggressive"]).optional(),
    min_ev: z.number().optional(),
    min_mapping_confidence: z.enum(["high", "medium", "low"]).optional(),
    odds_format: z.enum(["decimal", "american"]).optional(),
  }))
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const { id, ...patch } = data;
    if (id) return b.entities.UserSettings.update(id, patch);
    return b.entities.UserSettings.create({ timezone: "America/Asuncion", ...patch });
  });

// ---------- Watchlist ----------
export const listWatchlist = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const page = await b.entities.UserWatchlist.filter({}, { limit: 100 });
    return page.items || [];
  });

export const toggleWatchlist = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ item_type: z.enum(["event", "team", "competition", "signal"]), item_id: z.string(), label: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const page = await b.entities.UserWatchlist.filter({ item_type: data.item_type, item_id: data.item_id }, { limit: 1 });
    if (page.items?.[0]) { await b.entities.UserWatchlist.delete(page.items[0].id); return { watched: false }; }
    await b.entities.UserWatchlist.create({ item_type: data.item_type, item_id: data.item_id, label: data.label });
    return { watched: true };
  });

// ---------- Admin: manual import & sync ----------
export const importApostaEvent = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.any())
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    const p = await pipe();
    // Import only — no auto-predictions without external mapping and sufficient stats.
    // The admin must manually run the next pipeline steps:
    //   1. Match Fixtures (matchExternalFixtures)
    //   2. Sync Football Data (syncFootballData)
    //   3. Run Predictions (runPredictionModels)
    //   4. Calculate Value Signals (calculateValueSignals)
    const ev = await p.importApostaEventManual(b, data);
    return ev;
  });

export const syncNow = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ job: z.string(), eventId: z.string().optional() }).optional())
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    const p = await pipe();
    const job = data?.job || "full";
    const results = {};
    if (job === "full" || job === "aposta_events") results.aposta_events = await p.syncApostaEvents(b, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "aposta_odds") results.aposta_odds = await p.syncApostaOdds(b, data?.eventId, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "match") results.match = await p.matchExternalFixtures(b, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "football_data") results.football_data = await p.syncFootballData(b, data?.eventId, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "lineups") results.lineups = await p.updateInjuriesAndLineups(b, data?.eventId, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "predict") results.predict = await p.runPredictionModels(b, data?.eventId, "odds_update").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "value") results.value = await p.calculateValueSignals(b, data?.eventId, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "settle") results.settle = await p.settleFinishedMatches(b, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "metrics") results.metrics = await p.calculateModelMetrics(b, "manual").catch((e) => ({ error: e.message }));
    if (job === "full" || job === "health") results.health = await p.providerHealthCheck(b, "manual").catch((e) => ({ error: e.message }));
    await p.lockPastEvents(b).catch(() => {});
    return results;
  });

export const getSyncRuns = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ limit: z.number().optional() }).optional())
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44();
    const page = await b.entities.SyncRun.filter({}, { sort: "-started_at", limit: data?.limit || 30 });
    return page.items || [];
  });

export const getProviderHealth = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const page = await b.entities.ProviderHealth.filter({}, { limit: 20 });
    return page.items || [];
  });

export const getUnmatchedEvents = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    admin(context);
    const b = context.getBase44();
    const page = await b.entities.Event.filter({ mapping_status: { $in: ["unmatched", "ambiguous"] } }, { sort: "kickoff_utc", limit: 50 });
    return page.items || [];
  });

export const manualMapEvent = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ event_id: z.string(), external_event_id: z.string(), home_team_id: z.string().optional(), away_team_id: z.string().optional() }))
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    await b.entities.EventMapping.create({
      event_id: data.event_id, provider: "football_data", external_event_id: data.external_event_id,
      confidence: 1, match_method: "manual", is_confirmed: true,
    });
    await b.entities.Event.update(data.event_id, { mapping_status: "matched", mapping_confidence: 1, external_event_id: data.external_event_id });
    const ev = await b.entities.Event.get(data.event_id).catch(() => null);
    if (ev) {
      if (data.home_team_id) await addTeamAlias(b, data.home_team_id, ev.home_team_name, "manual").catch(() => {});
      if (data.away_team_id) await addTeamAlias(b, data.away_team_id, ev.away_team_name, "manual").catch(() => {});
    }
    return { ok: true };
  });

export const testConnections = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    const p = await pipe();
    const a = await apostaMod();
    const f = await footballMod();
    const aposta = await a.apostaHealthCheck();
    const football = await f.testConnection();
    await p.upsertProviderHealth(b, a.APOSTA_PROVIDER_NAME, aposta.status, aposta.error, aposta.latency_ms);
    await p.upsertProviderHealth(b, "football_data", football.status, football.error, football.latency_ms);
    return { aposta, football };
  });

export const getEventFeatures = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const p = await pipe();
    return await p.generateFeatures(b, data.id);
  });