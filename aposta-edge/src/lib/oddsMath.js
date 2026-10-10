// Pure odds mathematics. No server dependencies — safe for client and tests.
// All probabilities are stored as fractions 0..1.

export const validProbability = (p) => Number.isFinite(p) && p >= 0 && p <= 1;
export const validOdds = (o) => Number.isFinite(o) && o > 1;

export function impliedProbability(decimalOdds) {
  if (!validOdds(decimalOdds)) return null;
  return 1 / decimalOdds;
}

// Sum of raw implied probabilities for a mutually-exclusive market.
export function overround(probabilities) {
  if (!Array.isArray(probabilities) || probabilities.length < 2 || !probabilities.every((p) => validProbability(p) && p > 0)) return null;
  return probabilities.reduce((a, b) => a + b, 0);
}

export function margin(probabilities) {
  const o = overround(probabilities);
  return o == null ? null : o - 1;
}

// Normalise raw implied probabilities to remove the bookmaker margin (no-vig).
export function noVigNormalize(probabilities) {
  const sum = overround(probabilities);
  if (sum == null) return null;
  return probabilities.map((p) => p / sum);
}

// Convert a no-vig probability back to fair decimal odds.
export function fairOdds(probability) {
  if (!validProbability(probability) || probability === 0) return null;
  return 1 / probability;
}

export function decimalToAmerican(decimalOdds) {
  if (!validOdds(decimalOdds)) return null;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return Math.round(-100 / (decimalOdds - 1));
}

// Clamp a probability into a valid range, guarding against NaN.
export function clampProbability(p) {
  if (!Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

// Describe an odds movement between two decimal prices.
export function describeMovement(opening, current) {
  if (!Number.isFinite(opening) || !Number.isFinite(current)) return null;
  if (current < opening) return { direction: "shortened", delta: current - opening };
  if (current > opening) return { direction: "drifted", delta: current - opening };
  return { direction: "stable", delta: 0 };
}

export function formatOdds(odds) {
  if (odds == null || !Number.isFinite(odds)) return "—";
  return odds.toFixed(2);
}

export function formatPercent(p, digits = 1) {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(p, digits = 1) {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}