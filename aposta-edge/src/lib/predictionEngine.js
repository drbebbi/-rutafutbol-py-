// Deterministic football prediction engine. No LLM. No random numbers.
// Poisson goal model with Dixon-Coles low-score adjustment + Elo ensemble.

import { clampProbability, validProbability } from "@/lib/oddsMath";

// --- Poisson PMF via log-factorial recursion for numerical stability ---
export function poissonPmf(k, lambda) {
  if (!Number.isFinite(lambda) || lambda < 0 || !Number.isInteger(k) || k < 0) throw new Error("INVALID_POISSON_PARAMETERS");
  if (lambda === 0) return k === 0 ? 1 : 0;
  // P(0) = exp(-lambda); P(k) = P(k-1) * lambda / k
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}

const MAX_GOALS = 10;

// Dixon-Coles rho adjustment: corrects underestimation of 0-0, 1-0, 0-1, 1-1
// in low-scoring football. rho is a small parameter (typically -0.1..0.1).
export function dixonColesAdjustment(i, j, lambdaHome, lambdaAway, rho) {
  if (![lambdaHome, lambdaAway, rho].every(Number.isFinite) || lambdaHome < 0 || lambdaAway < 0) throw new Error("INVALID_DC_PARAMETERS");
  let tau = 1;
  if (i === 0 && j === 0) tau = 1 - lambdaHome * lambdaAway * rho;
  else if (i === 0 && j === 1) tau = 1 + lambdaHome * rho;
  else if (i === 1 && j === 0) tau = 1 + lambdaAway * rho;
  else if (i === 1 && j === 1) tau = 1 - rho;
  if (tau < 0) throw new Error("NEGATIVE_DC_FACTOR");
  return tau;
}

export function scoreMatrix(lambdaHome, lambdaAway, rho = 0) {
  // Validate all factors, including cells with zero Poisson mass. No clipping.
  for (const [i, j] of [[0, 0], [0, 1], [1, 0], [1, 1]]) dixonColesAdjustment(i, j, lambdaHome, lambdaAway, rho);
  const matrix = [];
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    matrix[i] = [];
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway) * dixonColesAdjustment(i, j, lambdaHome, lambdaAway, rho);
      matrix[i][j] = p;
      total += p;
    }
  }
  const tailMass = 1 - total;
  if (!Number.isFinite(total) || total <= 0 || tailMass < -1e-10 || tailMass > 0.0001) throw new Error("EXCESSIVE_TRUNCATED_MASS");
  for (const row of matrix) for (let j = 0; j < row.length; j++) row[j] /= total;
  matrix.tail_mass = Math.max(0, tailMass);
  return matrix;
}

export function derive1x2(matrix) {
  let home = 0,
    draw = 0,
    away = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      if (i > j) home += matrix[i][j];
      else if (i === j) draw += matrix[i][j];
      else away += matrix[i][j];
    }
  return { home: clampProbability(home), draw: clampProbability(draw), away: clampProbability(away) };
}

export function deriveOverUnder(matrix, line) {
  // Over/Under total goals. line e.g. 2.5
  let over = 0,
    under = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      const total = i + j;
      if (total > line) over += matrix[i][j];
      else if (total < line) under += matrix[i][j];
      // exact equal only matters on integer lines (push)
    }
  return { over: clampProbability(over), under: clampProbability(under) };
}

export function deriveBTTS(matrix) {
  let yes = 0,
    no = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      if (i > 0 && j > 0) yes += matrix[i][j];
      else no += matrix[i][j];
    }
  return { yes: clampProbability(yes), no: clampProbability(no) };
}

export function deriveTeamTotal(matrix, side, line, over = true) {
  // side: "home" | "away". line e.g. 1.5
  let res = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      const goals = side === "home" ? i : j;
      const hit = over ? goals > line : goals < line;
      if (hit) res += matrix[i][j];
    }
  return clampProbability(res);
}

export function deriveCorrectScore(matrix, topN = 6) {
  const flat = [];
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) flat.push({ score: `${i}-${j}`, prob: matrix[i][j] });
  flat.sort((a, b) => b.prob - a.prob);
  return flat.slice(0, topN);
}

// --- Elo team-strength model ---
export function eloExpected(ratingA, ratingB, homeAdvantage = 65) {
  const ea = 1 / (1 + Math.pow(10, (ratingB - (ratingA + homeAdvantage)) / 400));
  return ea;
}

export function eloUpdate(rating, opponent, score, k = 24, homeAdvantage = 65) {
  const expected = eloExpected(rating, opponent, homeAdvantage);
  return rating + k * (score - expected);
}

// Convert an Elo win expectation into an expected-goals estimate via a
// logistic mapping (calibrated heuristically; replaced by calibration data later).
export function eloToLambda(ratingA, ratingB, homeAdvantage = 65, baseGoals = 1.35) {
  const ea = eloExpected(ratingA, ratingB, homeAdvantage);
  // split a fixed expected total between the two sides by win expectation
  const total = baseGoals + Math.abs(ea - 0.5) * 0.6;
  const lambdaHome = clampProbability(ea) * total * 1.08;
  const lambdaAway = clampProbability(1 - ea) * total * 0.92;
  return { lambdaHome: Math.max(0.2, lambdaHome), lambdaAway: Math.max(0.2, lambdaAway) };
}

// --- Ensemble: combine goal-model + Elo-derived lambdas + feature blend ---
export function ensembleLambdas(goalLambdas, eloLambdas, featureLambdas, weights = { goal: 0.5, elo: 0.3, feature: 0.2 }) {
  const w = weights;
  const sum = w.goal + w.elo + w.feature;
  const blend = (a, b, c) => (a * w.goal + b * w.elo + c * w.feature) / sum;
  return {
    lambdaHome: blend(goalLambdas.lambdaHome, eloLambdas.lambdaHome, featureLambdas.lambdaHome),
    lambdaAway: blend(goalLambdas.lambdaAway, eloLambdas.lambdaAway, featureLambdas.lambdaAway),
  };
}

// Sigmoid (Platt) calibration. Given raw probability and fitted params a,b:
//   p_cal = 1 / (1 + exp(-(a*p + b)))
export function sigmoidCalibrate(p, a, b) {
  if (!validProbability(p) || !Number.isFinite(a) || !Number.isFinite(b)) throw new Error("FITTED_CALIBRATOR_REQUIRED");
  return 1 / (1 + Math.exp(-(a * p + b)));
}

// Full prediction for a 1X2 market from lambdas.
export function predictMatch(lambdaHome, lambdaAway, rho = 0) {
  const matrix = scoreMatrix(lambdaHome, lambdaAway, rho);
  const x1x2 = derive1x2(matrix);
  const ou25 = deriveOverUnder(matrix, 2.5);
  const btts = deriveBTTS(matrix);
  const correctScore = deriveCorrectScore(matrix);
  return {
    lambdaHome,
    lambdaAway,
    matrix,
    x1x2,
    overUnder25: ou25,
    btts,
    correctScore,
    expectedGoalsHome: lambdaHome,
    expectedGoalsAway: lambdaAway,
    tail_mass: matrix.tail_mass,
    rho,
    calibration_status: "RAW",
  };
}

// Validate a probability distribution sums to ~1 (numerical guard).
export function validateDistribution(probs, tolerance = 1e-8) {
  return Array.isArray(probs) && probs.length > 0 && probs.every(validProbability) &&
    Math.abs(probs.reduce((a, b) => a + b, 0) - 1) <= tolerance;
}