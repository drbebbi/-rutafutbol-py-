// Edge Analyst AI — a code agent on the Base44 AI gateway.
// Strict rule: the model may ONLY answer from data returned by its tools.
// It must NEVER invent games, odds, probabilities or recommendations.
import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser } from "@/lib/auth-middleware";

const SYSTEM_PROMPT = `You are the Edge Analyst, the in-app AI assistant for Aposta Edge AI, a quantitative football betting analysis platform.

ABSOLUTE RULES (never violate):
1. You may ONLY discuss events, odds, probabilities, value signals and recommendations that come back from your tools. You MUST call a tool before answering any question about a specific match, market or bet.
2. NEVER invent or estimate games, odds, probabilities, expected values, team names, scores or recommendations. If a tool returns no data, say plainly that there is not enough data and do not speculate.
3. All probabilities shown to the user come from the platform's deterministic statistical model (independent Poisson on recent-form features; Elo only when fitted). Never present your own numerical probabilities. If a prediction has computation_status "insufficient_data", say there is no forecast and list the reasons.
7. Only signals with published = true are recommendations. For any other signal state that it is NOT recommended and give its not_published_reasons. If the model validation status is not "validated", say that the model has not been validated out-of-sample.
4. When you mention a value signal or recommendation, always include its status (value / watch / strong_value / no_value), its expected value, and the data-quality and confidence indicators — never present a bet as a recommendation without them.
5. Be concise and direct. Use bullet points. Match the user's language (Portuguese if they write in Portuguese, English otherwise).
6. You do not give financial advice. You present analysis; the user decides. Never encourage reckless betting.

Available tools:
- listTopValueSignals: the current top value signals (active, ranked by quality-adjusted EV).
- getEventAnalysis: full analysis for a specific event by event id (probabilities, score matrix, value signals, data quality).
- searchEvents: search scheduled events by team name.
- getPerformanceMetrics: model calibration and betting performance metrics.
- getProviderHealth: data provider connection status.

If the user asks something none of these tools can answer, say you cannot help with that.`;

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
      }));
    });

    const getEventAnalysis = toolDefinition({
      name: "getEventAnalysis",
      description: "Get the full analysis for a specific event: model probabilities, expected goals, value signals and data quality. Use this when the user asks about a specific match.",
      inputSchema: z.object({ event_id: z.string() }),
    }).server(async ({ event_id }) => {
      const event = await base44.entities.Event.get(event_id).catch(() => null);
      if (!event) return { error: "Event not found" };
      const predPage = await base44.entities.Prediction.filter({ event_id }, { limit: 1, sort: "-version" });
      const prediction = predPage.items?.[0];
      const signalsPage = await base44.entities.ValueSignal.filter({ event_id, is_active: true }, { limit: 20 });
      const { signalEligibility } = await import("@/lib/server/provenance.js");
      const modelVersion = prediction?.model_version_id ? await base44.entities.ModelVersion.get(prediction.model_version_id).catch(() => null) : null;
      const selIds = (signalsPage.items || []).map((s) => s.selection_id).filter(Boolean);
      const sels = selIds.length ? await base44.entities.Selection.filter({ id: { $in: selIds } }, { limit: 50 }) : { items: [] };
      const selById = Object.fromEntries((sels.items || []).map((s) => [s.id, s]));
      return {
        event: { home: event.home_team_name, away: event.away_team_name, kickoff: event.kickoff_utc, status: event.status, competition: event.competition_name },
        prediction: prediction ? {
          computation_status: prediction.computation_status,
          insufficient_reasons: prediction.insufficient_reasons,
          market_probabilities: prediction.market_probabilities,
          probability_intervals_1se: prediction.probability_intervals,
          model_validation_status: modelVersion?.validation_status || "unvalidated",
          expected_goals_home: prediction.expected_goals_home,
          expected_goals_away: prediction.expected_goals_away,
          confidence: prediction.confidence,
          data_quality: prediction.data_quality,
          version: prediction.version,
        } : null,
        // `published: false` means the platform does NOT recommend it; the
        // reasons say why. Never present an unpublished signal as a tip.
        value_signals: (signalsPage.items || []).map((s) => {
          const gate = signalEligibility({ signal: s, event, prediction, selection: selById[s.selection_id], modelVersion });
          return {
            market: s.market_key, selection: s.selection, line: s.line,
            aposta_odds: s.aposta_odds, model_probability: s.model_probability, probability_interval_1se: s.probability_interval,
            expected_value: s.expected_value, ev_lower_1se: s.ev_lower, status: s.status, confidence: s.confidence,
            published: gate.eligible, not_published_reasons: gate.reasons,
          };
        }),
      };
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
      systemPrompts: [SYSTEM_PROMPT],
      tools: [listTopValueSignals, getEventAnalysis, searchEvents, getPerformanceMetrics, getProviderHealth],
      agentLoopStrategy: maxIterations(5),
    });
  });