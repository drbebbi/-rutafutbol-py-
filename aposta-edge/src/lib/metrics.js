// Settlement and evaluation metrics. Pure — used by the pipeline, the
// performance page and the backtest so every number has ONE definition.
//
// Definitions (flat staking, 1 unit per bet):
//   profit_units  = Σ (odds − 1) for wins, −1 for losses, 0 for push/void
//   staked_units  = number of bets with a stake that was not voided
//   yield         = profit_units / staked_units   (a.k.a. ROI on turnover)
//   roi           = identical to yield under flat 1-unit staking; it is kept
//                   only as an alias so no screen can show a different number.
//   max_drawdown  = largest peak-to-trough fall of the cumulative profit curve
//                   (in units), in chronological order of settlement.
//   clv           = taken_odds × closing_no_vig_probability − 1
//                   (EV of the taken price measured at the closing fair price).

const EPS = 1e-15;

export function outcome1x2(home, away) {
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return null;
  return home > away ? "home" : home === away ? "draw" : "away";
}

// Settle one selection of a supported market. Returns win | loss | push | void,
// or null when the score is not a confirmed integer result.
export function settleSelection({ market_key, selection, line = null }, home, away) {
  const r = outcome1x2(home, away);
  if (r == null) return null;
  if (market_key === "1x2") return ["home", "draw", "away"].includes(selection) ? (selection === r ? "win" : "loss") : "void";
  if (market_key === "btts") {
    const yes = home > 0 && away > 0;
    if (selection === "yes") return yes ? "win" : "loss";
    if (selection === "no") return yes ? "loss" : "win";
    return "void";
  }
  if (market_key === "over_under_goals") {
    if (!Number.isFinite(line) || Math.round(line * 4) !== line * 4 || (line * 4) % 2 !== 0) return "void"; // quarter lines unsupported
    const total = home + away;
    if (total === line) return "push";
    if (selection === "over") return total > line ? "win" : "loss";
    if (selection === "under") return total < line ? "win" : "loss";
    return "void";
  }
  return "void";
}

export function profitUnits(result, odds) {
  if (result === "win") return Number.isFinite(odds) && odds > 1 ? odds - 1 : null;
  if (result === "loss") return -1;
  if (result === "push" || result === "void") return 0;
  return null;
}

// bets: [{ odds, result, settled_at?, closing_no_vig_probability? }]
export function bettingSummary(bets) {
  const ordered = [...(bets || [])].filter((b) => ["win", "loss", "push", "void"].includes(b.result))
    .sort((a, b) => String(a.settled_at || "").localeCompare(String(b.settled_at || "")));
  let profit = 0, staked = 0, wins = 0, losses = 0, pushes = 0, peak = 0, maxDd = 0, oddsSum = 0;
  const clvs = [];
  for (const b of ordered) {
    const p = profitUnits(b.result, b.odds);
    if (p == null) continue;
    if (b.result !== "void") { staked += 1; oddsSum += b.odds; }
    if (b.result === "win") wins++; else if (b.result === "loss") losses++; else if (b.result === "push") pushes++;
    profit += p;
    peak = Math.max(peak, profit);
    maxDd = Math.max(maxDd, peak - profit);
    if (Number.isFinite(b.closing_no_vig_probability) && Number.isFinite(b.odds)) clvs.push(b.odds * b.closing_no_vig_probability - 1);
  }
  const yieldValue = staked > 0 ? profit / staked : null;
  return {
    bets: staked, wins, losses, pushes,
    staked_units: staked, profit_units: profit,
    yield: yieldValue, roi: yieldValue,
    hit_rate: wins + losses > 0 ? wins / (wins + losses) : null,
    max_drawdown_units: maxDd,
    avg_odds: staked > 0 ? oddsSum / staked : null,
    avg_clv: clvs.length ? clvs.reduce((a, c) => a + c, 0) / clvs.length : null,
    clv_sample_size: clvs.length,
  };
}

// Multiclass scoring for one categorical forecast.
// probs: { home, draw, away } (or any keys), outcome: one of the keys.
export function logLoss(probs, outcome) {
  const p = probs?.[outcome];
  if (!Number.isFinite(p)) return null;
  return -Math.log(Math.max(p, EPS));
}

export function brierScore(probs, outcome) {
  if (!probs || !(outcome in probs)) return null;
  let s = 0;
  for (const [k, p] of Object.entries(probs)) s += (p - (k === outcome ? 1 : 0)) ** 2;
  return s;
}

// forecasts: [{ probs, outcome }] — one row per MATCH (not per selection).
export function forecastSummary(forecasts) {
  const rows = (forecasts || []).filter((f) => f.probs && f.outcome && Number.isFinite(f.probs[f.outcome]));
  const n = rows.length;
  if (n === 0) return { sample_size: 0, log_loss: null, brier_score: null, accuracy: null };
  let ll = 0, bs = 0, hits = 0;
  for (const f of rows) {
    ll += logLoss(f.probs, f.outcome);
    bs += brierScore(f.probs, f.outcome);
    const argmax = Object.entries(f.probs).sort((a, b) => b[1] - a[1])[0][0];
    if (argmax === f.outcome) hits++;
  }
  return { sample_size: n, log_loss: ll / n, brier_score: bs / n, accuracy: hits / n };
}

// Reliability diagram data. pairs: [{ p, y }] with y ∈ {0,1}.
export function calibrationBins(pairs, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ lower: i / bins, upper: (i + 1) / bins, n: 0, mean_p: null, observed: null, _sp: 0, _sy: 0 }));
  for (const { p, y } of pairs || []) {
    if (!Number.isFinite(p) || p < 0 || p > 1 || (y !== 0 && y !== 1)) continue;
    const b = out[Math.min(bins - 1, Math.floor(p * bins))];
    b.n++; b._sp += p; b._sy += y;
  }
  return out.map(({ _sp, _sy, ...b }) => ({ ...b, mean_p: b.n ? _sp / b.n : null, observed: b.n ? _sy / b.n : null }));
}

// Expected calibration error (weighted by bin size).
export function expectedCalibrationError(bins) {
  const total = bins.reduce((a, b) => a + b.n, 0);
  if (!total) return null;
  return bins.reduce((a, b) => a + (b.n ? (b.n / total) * Math.abs(b.mean_p - b.observed) : 0), 0);
}
