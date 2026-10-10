// Pure model-input assembly. Decides whether the platform has enough real
// information to produce a prediction at all, and with which components.
//
// Rules (fail-closed):
//   * The form/feature component is REQUIRED. Without at least MIN_TEAM_SAMPLE
//     verified, pre-kickoff matches per team there is no prediction.
//   * Elo is used only when both teams carry ratings fitted from at least
//     MIN_ELO_GAMES results. The 1500 default is a prior, not information.
//   * No Dixon-Coles correction is applied until rho is fitted from data
//     (rho = 0 → independent Poisson); the model is labelled accordingly.
import { validateFeatures, featureLambdas } from "./features.js";
import { eloToLambda, ensembleLambdas, predictMatch } from "../predictionEngine.js";

export const MIN_ELO_GAMES = 10;
export const MODEL_COMPONENTS = ["poisson_independent", "form_features", "elo_optional"];
export const ENSEMBLE_WEIGHTS = { feature: 0.7, elo: 0.3 };

const eloFitted = (team) => Number.isFinite(team?.elo_rating) && (team?.elo_games ?? 0) >= MIN_ELO_GAMES;

export function buildModelLambdas({ features, homeTeam, awayTeam }) {
  const validation = validateFeatures(features);
  if (!validation.valid) return { status: "insufficient_data", reasons: validation.reasons, lambdas: null, components: {} };
  const feature = featureLambdas(features);
  const components = { feature, elo: null, weights: { feature: 1, elo: 0 } };
  let lambdas = feature;
  if (eloFitted(homeTeam) && eloFitted(awayTeam)) {
    const elo = eloToLambda(homeTeam.elo_rating, awayTeam.elo_rating);
    // ensembleLambdas expects three components; the goal slot is unused (weight 0).
    lambdas = ensembleLambdas(feature, elo, feature, { goal: 0, elo: ENSEMBLE_WEIGHTS.elo, feature: ENSEMBLE_WEIGHTS.feature });
    components.elo = elo;
    components.weights = { ...ENSEMBLE_WEIGHTS };
  }
  return { status: "computed", reasons: [], lambdas, components };
}

// Sampling uncertainty of the feature lambdas. Each team mean is an average of
// n Poisson counts, so Var(mean) ≈ mean / n. lambdaHome = (a + b) / 2 with a,b
// independent sample means → SE = sqrt(a/n_a + b/n_b) / 2.
export function lambdaStandardErrors(features) {
  const h = features.home, a = features.away;
  const se = (m1, n1, m2, n2) => Math.sqrt(m1 / n1 + m2 / n2) / 2;
  return {
    home: se(h.avg_goals, h.sample_size, a.avg_goals_conceded, a.sample_size),
    away: se(a.avg_goals, a.sample_size, h.avg_goals_conceded, h.sample_size),
  };
}

const marketProbabilities = (p) => ({
  "1x2": { home: p.x1x2.home, draw: p.x1x2.draw, away: p.x1x2.away },
  "over_under_goals:2.5": { over: p.overUnder25.over, under: p.overUnder25.under },
  btts: { yes: p.btts.yes, no: p.btts.no },
});

// Point probabilities for every supported market plus a ±1 SE sensitivity
// band (min/max over the four lambda corners). The band reflects sampling
// noise of the inputs only — not model misspecification — and is labelled so.
export function predictAllMarkets(lambdas, standardErrors = null) {
  const point = predictMatch(lambdas.lambdaHome, lambdas.lambdaAway);
  const probabilities = marketProbabilities(point);
  let intervals = null;
  if (standardErrors) {
    intervals = {};
    const corners = [];
    for (const dh of [-1, 1]) for (const da of [-1, 1]) {
      const lh = Math.max(0.05, lambdas.lambdaHome + dh * standardErrors.home);
      const la = Math.max(0.05, lambdas.lambdaAway + da * standardErrors.away);
      corners.push(marketProbabilities(predictMatch(lh, la)));
    }
    for (const [market, sels] of Object.entries(probabilities)) {
      intervals[market] = {};
      for (const sel of Object.keys(sels)) {
        const vals = corners.map((c) => c[market][sel]).concat(sels[sel]);
        intervals[market][sel] = [Math.min(...vals), Math.max(...vals)];
      }
    }
  }
  return { point, probabilities, intervals };
}
