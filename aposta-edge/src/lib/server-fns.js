// Server functions exposed to the frontend. All require a signed-in user;
// admin-only actions additionally check the role.
// Server-only modules (pipeline, providers) are loaded lazily so they never
// enter the client bundle — handlers run server-side only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";
import { addTeamAlias } from "@/lib/server/eventMatcher.js";
import { isDemoEvent, kickoffPassed } from "@/lib/server/provenance.js";

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
    const { loadEventDetail } = await import("@/lib/server/eventDetail.js");
    return loadEventDetail(context.getBase44(), data.id);
  });

export const listRecommendations = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .validator(z.object({ limit: z.number().optional() }).optional())
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    // Shared provenance-gated filtering — same rules as the Edge Analyst AI.
    const { filterEligibleSignals } = await import("@/lib/server/signalFilter.js");
    return await filterEligibleSignals(b, { limit: data?.limit || 50, userId: context.user.id });
  });

export const getPerformanceMetrics = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const p = await pipe();
    const [perf, modelPage] = await Promise.all([
      p.computePerformance(b),
      b.entities.ModelVersion.filter({ is_production: true }, { limit: 1 }),
    ]);
    const mv = modelPage.items?.[0];
    return { model_version: mv?.version_label || "—", validation_status: mv?.validation_status || "unvalidated", ...perf };
  });

// ---------- User settings ----------
export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const page = await b.entities.UserSettings.filter({ created_by_id: context.user.id }, { limit: 1 });
    if (page.items?.[0]) return page.items[0];
    return await b.entities.UserSettings.create({ timezone: "America/Asuncion", value_profile: "balanced", min_ev: 3 });
  });

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    id: z.string().optional(),
    timezone: z.string().optional(),
    value_profile: z.enum(["conservative", "balanced", "aggressive"]).optional(),
    min_ev: z.number().min(0).max(50).optional(),
    min_mapping_confidence: z.enum(["high", "medium", "low"]).optional(),
    odds_format: z.enum(["decimal", "american"]).optional(),
  }))
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const { id, ...patch } = data;
    // Only the caller's own row — admins included (RLS would let them edit any).
    const own = await b.entities.UserSettings.filter({ created_by_id: context.user.id }, { limit: 1 });
    const mine = own.items?.[0];
    if (id && mine?.id !== id) throw Object.assign(new Error("Forbidden"), { status: 403 });
    if (mine) return b.entities.UserSettings.update(mine.id, patch);
    return b.entities.UserSettings.create({ timezone: "America/Asuncion", ...patch });
  });

// ---------- Watchlist ----------
export const listWatchlist = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const b = context.getBase44();
    const page = await b.entities.UserWatchlist.filter({ created_by_id: context.user.id }, { limit: 100 });
    return page.items || [];
  });

export const toggleWatchlist = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ item_type: z.enum(["event", "team", "competition", "signal"]), item_id: z.string(), label: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const b = context.getBase44();
    const page = await b.entities.UserWatchlist.filter({ created_by_id: context.user.id, item_type: data.item_type, item_id: data.item_id }, { limit: 1 });
    if (page.items?.[0]) { await b.entities.UserWatchlist.delete(page.items[0].id); return { watched: false }; }
    await b.entities.UserWatchlist.create({ item_type: data.item_type, item_id: data.item_id, label: data.label });
    return { watched: true };
  });

// ---------- Admin: manual import & sync ----------
export const importApostaEvent = createServerFn({ method: "POST" })
  .middleware([requireUser])
  // Shape is validated by validateApostaImport; here only bound the payload.
  .validator(z.record(z.string(), z.any()).refine((v) => JSON.stringify(v).length <= 200_000, "PAYLOAD_TOO_LARGE"))
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

// Admin reads odds on aposta.la and types them in (the lawful path: aposta.la
// disallows automated /api/ access and uses bot protection). The observation
// time is the SERVER time of submission, the capture counts as admin-verified,
// and the event is predicted and evaluated right away.
const oddsField = z.union([z.string().max(10), z.number()]).optional();
export const captureApostaOdds = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({
    event_url: z.string().max(300), home_team: z.string().max(80), away_team: z.string().max(80),
    competition: z.string().max(120).optional(), kickoff_local: z.string().max(16), confirmed_now: z.boolean(),
    odds_home: oddsField, odds_draw: oddsField, odds_away: oddsField, odds_over25: oddsField, odds_under25: oddsField,
    odds_btts_yes: oddsField, odds_btts_no: oddsField,
  }))
  .handler(async ({ data, context }) => {
    admin(context);
    const { buildCapturePayload } = await import("@/lib/apostaCapture.js");
    const built = buildCapturePayload(data, new Date().toISOString());
    if (!built.ok) throw Object.assign(new Error(built.errors.join(" · ")), { status: 400 });
    const b = context.getBase44().asServiceRole;
    const p = await pipe();
    const ev = await p.importApostaEventManual(b, built.payload);
    await p.verifyManualEvent(b, ev.id, context.user.id);
    const predict = await p.runPredictionModels(b, ev.id, "odds_update").catch((e) => ({ error: e.message }));
    const value = await p.calculateValueSignals(b, ev.id, "manual").catch((e) => ({ error: e.message }));
    return { event_id: ev.id, aposta_event_id: built.payload.aposta_event_id, kickoff_utc: built.payload.kickoff_utc, predict: predict?.details?.results?.[0] || predict, value };
  });

// Admin attests that a manually imported event (teams, kickoff, odds) was
// checked on aposta.la. Without this, manual imports never publish.
export const verifyManualEvent = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ event_id: z.string() }))
  .handler(async ({ data, context }) => {
    admin(context);
    const p = await pipe();
    return p.verifyManualEvent(context.getBase44().asServiceRole, data.event_id, context.user.id);
  });

// Record the out-of-sample validation decision for a model version. Requires a
// reference to the stored backtest report; "validated" unlocks publishing.
export const setModelValidation = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ model_version_id: z.string(), validation_status: z.enum(["validated", "unvalidated", "rejected"]), backtest_reference: z.string().min(3).max(500) }))
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    return b.entities.ModelVersion.update(data.model_version_id, {
      validation_status: data.validation_status, validation_reference: data.backtest_reference,
      validated_by: context.user.id, validated_at: new Date().toISOString(),
    });
  });

const SYNC_JOBS = ["full", "cycle", "aposta_events", "aposta_odds", "match", "football_data", "lineups", "predict", "value", "results", "settle", "metrics", "health"];
export const syncNow = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ job: z.enum(SYNC_JOBS), eventId: z.string().optional() }).optional())
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    const p = await pipe();
    const job = data?.job || "cycle";
    if (job === "full" || job === "cycle") return { cycle: await p.runScheduledCycle(b, "manual") };
    const ev = data?.eventId || null;
    const run = {
      aposta_events: () => p.syncApostaEvents(b, "manual"),
      aposta_odds: () => p.syncApostaOdds(b, ev, "manual"),
      match: () => p.matchExternalFixtures(b, "manual"),
      football_data: () => p.syncFootballData(b, ev, "manual"),
      lineups: () => p.updateInjuriesAndLineups(b, ev, "manual"),
      predict: () => p.runPredictionModels(b, ev, "odds_update"),
      value: () => p.calculateValueSignals(b, ev, "manual"),
      results: () => p.syncResults(b, "manual"),
      settle: () => p.settleFinishedMatches(b, "manual"),
      metrics: () => p.calculateModelMetrics(b, "manual"),
      health: () => p.providerHealthCheck(b, "manual"),
    }[job];
    const result = await run().catch((e) => ({ error: e.message }));
    await p.lockPastEvents(b).catch(() => {});
    return { [job]: result };
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
    // Raw provider errors can echo endpoint URLs (which may carry tokens):
    // only admins see them; everyone else gets the status.
    if (context.user?.role === "admin") return page.items || [];
    return (page.items || []).map(({ error_message, config, ...rest }) => ({ ...rest, error_message: error_message ? "unavailable" : null }));
  });

export const getUnmatchedEvents = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    admin(context);
    const b = context.getBase44();
    const page = await b.entities.Event.filter({ mapping_status: { $in: ["unmatched", "ambiguous"] } }, { sort: "kickoff_utc", limit: 50 });
    return page.items || [];
  });

// Manual mapping still goes through the provider: the fixture must exist and
// its team ids are linked (with conflict checks) exactly like an auto match.
export const manualMapEvent = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(z.object({ event_id: z.string(), external_event_id: z.string().regex(/^\d+$/), home_team_id: z.string().optional(), away_team_id: z.string().optional() }))
  .handler(async ({ data, context }) => {
    admin(context);
    const b = context.getBase44().asServiceRole;
    const p = await pipe();
    const f = await footballMod();
    if (!f.isConfigured()) throw Object.assign(new Error("Football data provider not configured"), { status: 409 });
    const ev = await b.entities.Event.get(data.event_id).catch(() => null);
    if (!ev) throw Object.assign(new Error("Event not found"), { status: 404 });
    const fixture = await f.getFixture(data.external_event_id);
    const result = await p.applyFixtureMapping(b, ev, fixture, 1, "manual", { admin: context.user.id });
    if (result.mapped) {
      if (data.home_team_id) await addTeamAlias(b, data.home_team_id, ev.home_team_name, "manual").catch(() => {});
      if (data.away_team_id) await addTeamAlias(b, data.away_team_id, ev.away_team_name, "manual").catch(() => {});
    }
    return { ok: result.mapped, ...result };
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