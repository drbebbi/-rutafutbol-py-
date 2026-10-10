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
      const { computePerformance } = await import("@/lib/server/syncPipeline.server.js");
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
  });