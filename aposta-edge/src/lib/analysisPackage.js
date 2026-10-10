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
