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
3. All probabilities shown to the user come from the platform's deterministic statistical model (Poisson/Dixon-Coles + Elo ensemble). Never present your own numerical probabilities.
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
      const signals = await filterEligibleSignals(base44, { limit });
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
      return {
        event: { home: event.home_team_name, away: event.away_team_name, kickoff: event.kickoff_utc, status: event.status, competition: event.competition_name },
        prediction: prediction ? {
          probabilities: prediction.probabilities,
          expected_goals_home: prediction.expected_goals_home,
          expected_goals_away: prediction.expected_goals_away,
          confidence: prediction.confidence,
          confidence_score: prediction.confidence_score,
          data_quality: prediction.data_quality,
          version: prediction.version,
        } : null,
        value_signals: (signalsPage.items || []).map((s) => ({
          market: s.market_key, selection: s.selection, line: s.line,
          aposta_odds: s.aposta_odds, model_probability: s.model_probability,
          expected_value: s.expected_value, status: s.status, confidence: s.confidence,
        })),
      };
    });

    const searchEvents = toolDefinition({
      name: "searchEvents",
      description: "Search scheduled events by team name (substring match). Returns upcoming events with ids so the user can ask for full analysis next.",
      inputSchema: z.object({ team: z.string().max(60) }),
    }).server(async ({ team }) => {
      const page = await base44.entities.Event.filter(
        { $or: [{ home_team_name: { $regex: team, $options: "i" } }, { away_team_name: { $regex: team, $options: "i" } }] },
        { sort: "kickoff_utc", limit: 15 }
      );
      return (page.items || []).map((e) => ({
        id: e.id, home: e.home_team_name, away: e.away_team_name,
        kickoff: e.kickoff_utc, competition: e.competition_name, status: e.status,
      }));
    });

    const getPerformanceMetrics = toolDefinition({
      name: "getPerformanceMetrics",
      description: "Get the model's calibration and betting performance metrics (log loss, Brier score, accuracy, ROI, yield).",
      inputSchema: z.object({}),
    }).server(async () => {
      const outcomesPage = await base44.entities.PredictionOutcome.filter({ result: { $in: ["win", "loss"] } }, { limit: 500 });
      const recsPage = await base44.entities.Recommendation.filter({ settlement_status: { $in: ["win", "loss"] } }, { limit: 500 });
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
        sample_size: outcomes.length,
        log_loss: logLoss / n,
        brier_score: brier / n,
        accuracy: correct / n,
        bets: recs.length, wins, losses,
        roi: staked > 0 ? profit / staked : 0,
        yield: profit,
      };
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