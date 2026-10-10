// Pure Aposta data normalizer and validator. No server dependencies — safe for tests.
// This module owns the CANONICAL IMPORT CONTRACT: all consumers use
// home_team_name, away_team_name, competition_name.
// Legacy input fields (home_team, away_team, competition) are accepted as
// aliases ONLY in normalizeApostaEvent and mapped to canonical names.

const PROVIDER = "APOSTA";

const MARKET_KEY_MAP = {
  "1x2": "1x2",
  "match_result": "1x2",
  "double_chance": "double_chance",
  "draw_no_bet": "draw_no_bet",
  "over_under": "over_under_goals",
  "btts": "btts",
  "both_teams_to_score": "btts",
  "asian_handicap": "asian_handicap",
  "team_totals": "team_totals",
  "first_half_result": "first_half_result",
  "half_time_full_time": "ht_ft",
  "correct_score": "correct_score",
};

export function normalizeMarketKey(rawKey) {
  if (!rawKey) return null;
  const k = String(rawKey).toLowerCase().trim().replace(/\s+/g, "_");
  return MARKET_KEY_MAP[k] || k;
}

// Normalize a raw Aposta event payload into the canonical event shape.
// Accepts legacy field aliases (home_team, away_team, competition) as input.
export function normalizeApostaEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const sport = raw.sport || raw.sport_id || "football";
  const observedAt = raw.source_timestamp || raw.observed_at || null;
  return {
    aposta_event_id: String(raw.aposta_event_id || raw.id || raw.event_id || ""),
    sport: String(sport).toLowerCase(),
    country: raw.country || null,
    competition_name: raw.competition_name || raw.competition || raw.league || null,
    home_team_name: raw.home_team_name || raw.home_team || raw.home || null,
    away_team_name: raw.away_team_name || raw.away_team || raw.away || null,
    kickoff_utc: raw.kickoff_utc || raw.kickoff || raw.start || null,
    status: raw.status || "scheduled",
    event_url: raw.aposta_event_url || raw.event_url || raw.url || null,
    markets: Array.isArray(raw.markets) ? raw.markets.map((m) => normalizeApostaMarket(m, observedAt)) : [],
    source_timestamp: observedAt,
    retrieved_at: new Date().toISOString(),
  };
}

export function normalizeApostaMarket(raw, inheritedTimestamp = null) {
  const marketStatus = raw.status || (raw.is_suspended ? "suspended" : "unknown");
  return {
    market_key: normalizeMarketKey(raw.market_key || raw.key),
    market_name: raw.market_name || raw.name || null,
    period: raw.period || "full_time",
    line: raw.line != null ? Number(raw.line) : null,
    line_label: raw.line_label || null,
    provider_market_id: raw.provider_market_id || raw.id || null,
    provider_market_name: raw.provider_market_name || raw.name || null,
    status: marketStatus,
    source_timestamp: raw.source_timestamp || raw.observed_at || inheritedTimestamp,
    selections: Array.isArray(raw.selections)
      ? raw.selections.map((s) => normalizeApostaSelection(s, raw, marketStatus, inheritedTimestamp))
      : [],
    raw_payload: raw.raw_payload || raw,
  };
}

function normalizeApostaSelection(s, market, marketStatus, inheritedTimestamp) {
  const selStatus = s.status || (s.is_suspended || s.suspended ? "suspended" : marketStatus === "open" ? "open" : "unknown");
  return {
    selection: s.selection || s.key || s.name,
    selection_label: s.selection_label || s.label || s.name,
    odds: Number(s.odds ?? s.decimal_odds),
    line: s.line != null ? Number(s.line) : market.line != null ? Number(market.line) : null,
    provider_selection_id: s.provider_selection_id || s.id || null,
    status: selStatus,
    source_timestamp: s.source_timestamp || s.observed_at || market.source_timestamp || inheritedTimestamp,
  };
}

export const APOSTA_PROVIDER_NAME = PROVIDER;

// Validate a normalized Aposta event for import.
// Returns { valid, errors[] }. An invalid import must NOT produce any DB records.
export function validateApostaImport(normalized) {
  const errors = [];
  if (!normalized || typeof normalized !== "object") {
    return { valid: false, errors: ["INVALID_PAYLOAD"] };
  }
  if (!normalized.aposta_event_id || String(normalized.aposta_event_id).trim() === "") {
    errors.push("MISSING_APOSTA_EVENT_ID");
  }
  if (!normalized.home_team_name || String(normalized.home_team_name).trim() === "") {
    errors.push("MISSING_HOME_TEAM_NAME");
  }
  if (!normalized.away_team_name || String(normalized.away_team_name).trim() === "") {
    errors.push("MISSING_AWAY_TEAM_NAME");
  }
  if (normalized.home_team_name && normalized.away_team_name &&
      normalized.home_team_name.toLowerCase() === normalized.away_team_name.toLowerCase()) {
    errors.push("SAME_TEAM");
  }
  if (normalized.sport && typeof normalized.sport !== "string") {
    errors.push("INVALID_SPORT");
  }
  // kickoff: must be valid ISO date if present
  if (normalized.kickoff_utc) {
    const ts = Date.parse(normalized.kickoff_utc);
    if (!Number.isFinite(ts)) {
      errors.push("INVALID_KICKOFF");
    } else {
      const futureLimit = Date.now() + 365 * 24 * 60 * 60 * 1000;
      if (ts > futureLimit) {
        errors.push("FUTURE_KICKOFF_IMPLAUSIBLE");
      }
    }
  }
  // source_timestamp / observed_at: reject implausibly future timestamps (> 24h)
  if (normalized.source_timestamp) {
    const ts = Date.parse(normalized.source_timestamp);
    if (Number.isFinite(ts) && ts > Date.now() + 24 * 60 * 60 * 1000) {
      errors.push("FUTURE_OBSERVED_AT_IMPLAUSIBLE");
    }
  }
  // markets: validate each market and its selections
  if (normalized.markets && Array.isArray(normalized.markets)) {
    for (const m of normalized.markets) {
      if (!m.market_key) errors.push("MARKET_MISSING_KEY");
      if (!Array.isArray(m.selections)) errors.push("MARKET_MISSING_SELECTIONS");
      for (const s of m.selections || []) {
        if (!s.selection) errors.push("SELECTION_MISSING_NAME");
        if (!Number.isFinite(s.odds) || s.odds <= 1) errors.push("SELECTION_INVALID_ODDS");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}