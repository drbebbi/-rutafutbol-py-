import { describe, it, expect, vi } from "vitest";

// Mock the provider modules that depend on base44:runtime (secrets).
// These mocks intercept the lazy dynamic imports in syncPipeline.server.js.
vi.mock("@/lib/server/apostaProvider.server.js", () => ({
  fetchApostaEvents: vi.fn(),
  fetchApostaOdds: vi.fn(),
  apostaHealthCheck: vi.fn(),
  APOSTA_PROVIDER_NAME: "APOSTA",
  normalizeApostaEvent: vi.fn((raw) => normalizeApostaEventReal(raw)),
  normalizeApostaMarket: vi.fn((raw) => normalizeApostaMarketReal(raw)),
  validateApostaImport: vi.fn((raw) => validateApostaImportReal(raw)),
}));

vi.mock("@/lib/server/footballDataProvider.server.js", () => ({
  getFixturesByDate: vi.fn(),
  getTeamLastMatches: vi.fn(),
  getLineups: vi.fn(),
  getInjuries: vi.fn(),
  getStandings: vi.fn(),
  testConnection: vi.fn(),
  isConfigured: vi.fn(() => false),
  FOOTBALL_DATA_PROVIDERS: ["api_football"],
}));

import {
  recordOddsSnapshot, syncApostaOdds,
  importApostaEventManual, ensureMarket,
} from "@/lib/server/syncPipeline.server.js";
import {
  normalizeApostaEvent as normalizeApostaEventReal,
  normalizeApostaMarket as normalizeApostaMarketReal,
  validateApostaImport as validateApostaImportReal,
} from "@/lib/server/apostaNormalizer.js";
import { signalEligibility } from "@/lib/server/provenance.js";

// --- Mock DB client ---
function matchesQuery(record, query) {
  if (!query) return true;
  for (const [key, value] of Object.entries(query)) {
    if (key === "$or") {
      if (!value.some((q) => matchesQuery(record, q))) return false;
    } else if (key === "id" || key === "_id") {
      if (Array.isArray(value)) {
        if (!value.includes(record.id)) return false;
      } else if (record.id !== value) return false;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.$in && !value.$in.includes(record[key])) return false;
      if (value.$nin && value.$nin.includes(record[key])) return false;
      if (value.$ne && record[key] === value.$ne) return false;
      if (value.$gte != null && !(record[key] >= value.$gte)) return false;
      if (value.$lt != null && !(record[key] < value.$lt)) return false;
      if (value.$exists !== undefined) {
        const exists = record[key] != null;
        if (value.$exists && !exists) return false;
        if (!value.$exists && exists) return false;
      }
      if (value.$regex && record[key] && !new RegExp(value.$regex, value.$options || "").test(record[key])) return false;
    } else {
      if (record[key] !== value) return false;
    }
  }
  return true;
}

function createMockDb(initialData = {}) {
  const stores = {};
  for (const [entity, records] of Object.entries(initialData)) {
    stores[entity] = records.map((r, i) => ({ id: `${entity}-${i + 1}`, created_date: "2026-10-10T00:00:00Z", ...r }));
  }
  const entities = ["Event", "Team", "Competition", "Market", "Selection", "OddsSnapshot",
    "Prediction", "ValueSignal", "SyncRun", "ProviderHealth", "TeamAlias", "CompetitionAlias",
    "ModelVersion", "Model", "TeamMatchStat", "Lineup", "Injury", "UserSettings",
    "PredictionOutcome", "Recommendation", "Settlement", "EventMapping", "PipelineLease",
    "StandingSnapshot", "UserWatchlist"];
  for (const e of entities) if (!stores[e]) stores[e] = [];
  let idCounter = 0;
  return {
    _stores: stores,
    entities: new Proxy({}, {
      get: (_, name) => {
        const store = stores[name] || (stores[name] = []);
        return {
          filter: vi.fn(async (query = {}, opts = {}) => {
            let items = store.filter((r) => matchesQuery(r, query));
            if (opts.sort) {
              const desc = opts.sort.startsWith("-");
              const field = desc ? opts.sort.slice(1) : opts.sort;
              items = [...items].sort((a, b) => {
                const av = a[field], bv = b[field];
                if (av == null) return 1;
                if (bv == null) return -1;
                return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
              });
            }
            return { items: items.slice(0, opts.limit || 50), next_cursor: null, has_more: false };
          }),
          get: vi.fn(async (id) => {
            const r = store.find((r) => r.id === id);
            if (!r) { const err = new Error("Not found"); err.status = 404; throw err; }
            return r;
          }),
          create: vi.fn(async (data) => {
            const record = { id: `${name}-${++idCounter}`, created_date: new Date().toISOString(), ...data };
            store.push(record);
            return record;
          }),
          update: vi.fn(async (id, patch) => {
            const r = store.find((r) => r.id === id);
            if (r) Object.assign(r, patch);
            return r;
          }),
          updateMany: vi.fn(async (query, update) => {
            const matches = store.filter((r) => matchesQuery(r, query));
            for (const r of matches) { if (update.$set) Object.assign(r, update.$set); }
            return { modified: matches.length };
          }),
          delete: vi.fn(async (id) => {
            const idx = store.findIndex((r) => r.id === id);
            if (idx >= 0) store.splice(idx, 1);
            return { deleted: 1 };
          }),
          list: vi.fn(async (opts = {}) => ({ items: store.slice(0, opts.limit || 50), next_cursor: null, has_more: false })),
          count: vi.fn(async (query = {}) => store.filter((r) => matchesQuery(r, query)).length),
        };
      },
    }),
  };
}

// --- Tests ---

describe("1. Valid manual import with legacy input fields", () => {
  it("imports event with home_team/away_team/competition aliases", async () => {
    const db = createMockDb();
    const raw = {
      aposta_event_id: "evt-100",
      home_team: "Fluminense",
      away_team: "Vasco",
      competition: "Brasileirão",
      kickoff_utc: "2026-10-15T20:00:00Z",
      markets: [{ market_key: "1x2", selections: [
        { selection: "home", odds: 1.9 },
        { selection: "draw", odds: 3.2 },
        { selection: "away", odds: 4.0 },
      ] }],
    };
    const ev = await importApostaEventManual(db, raw);
    expect(ev.home_team_name).toBe("Fluminense");
    expect(ev.away_team_name).toBe("Vasco");
    expect(ev.competition_name).toBe("Brasileirão");
    expect(ev.provenance).toBe("manual_import");
    // Event was created
    expect(db._stores.Event.length).toBe(1);
    // Teams were created
    expect(db._stores.Team.length).toBe(2);
    // Market was created
    expect(db._stores.Market.length).toBe(1);
    // Selections were created (3 for 1x2)
    expect(db._stores.Selection.length).toBe(3);
    // Snapshots were created (3 for 1x2)
    expect(db._stores.OddsSnapshot.length).toBe(3);
  });
});

describe("2. Import with canonical field names", () => {
  it("imports event with home_team_name/away_team_name/competition_name", async () => {
    const db = createMockDb();
    const raw = {
      aposta_event_id: "evt-101",
      home_team_name: "Palmeiras",
      away_team_name: "Corinthians",
      competition_name: "Brasileirão",
      kickoff_utc: "2026-10-15T20:00:00Z",
    };
    const ev = await importApostaEventManual(db, raw);
    expect(ev.home_team_name).toBe("Palmeiras");
    expect(ev.away_team_name).toBe("Corinthians");
    expect(ev.competition_name).toBe("Brasileirão");
  });
});

describe("3. Repeated import creates no second event", () => {
  it("upserts by aposta_event_id — no duplicate", async () => {
    const db = createMockDb();
    const raw = {
      aposta_event_id: "evt-102",
      home_team_name: "Team A",
      away_team_name: "Team B",
      kickoff_utc: "2026-10-15T20:00:00Z",
    };
    await importApostaEventManual(db, raw);
    await importApostaEventManual(db, raw);
    expect(db._stores.Event.length).toBe(1);
    expect(db._stores.Team.length).toBe(2); // no duplicate teams
  });
});

describe("4. Invalid import writes no records", () => {
  it("rejects missing team names — no DB writes", async () => {
    const db = createMockDb();
    const raw = { aposta_event_id: "evt-103", kickoff_utc: "2026-10-15T20:00:00Z" };
    await expect(importApostaEventManual(db, raw)).rejects.toThrow();
    expect(db._stores.Event.length).toBe(0);
    expect(db._stores.Team.length).toBe(0);
    expect(db._stores.Market.length).toBe(0);
    expect(db._stores.OddsSnapshot.length).toBe(0);
  });

  it("rejects same team for home and away", async () => {
    const db = createMockDb();
    const raw = {
      aposta_event_id: "evt-104",
      home_team_name: "Same FC",
      away_team_name: "Same FC",
      kickoff_utc: "2026-10-15T20:00:00Z",
    };
    await expect(importApostaEventManual(db, raw)).rejects.toThrow();
    expect(db._stores.Event.length).toBe(0);
  });

  it("rejects invalid odds (<=1)", async () => {
    const db = createMockDb();
    const raw = {
      aposta_event_id: "evt-105",
      home_team_name: "Team A",
      away_team_name: "Team B",
      kickoff_utc: "2026-10-15T20:00:00Z",
      markets: [{ market_key: "1x2", selections: [{ selection: "home", odds: 0.9 }] }],
    };
    await expect(importApostaEventManual(db, raw)).rejects.toThrow();
    expect(db._stores.Event.length).toBe(0);
  });
});

describe("5. Unconfigured provider does not set success timestamp", () => {
  it("does not set last_odds_success_at when unconfigured", async () => {
    const db = createMockDb({
      Event: [{
        id: "evt-200",
        aposta_event_id: "ap-200",
        home_team_name: "Team A",
        away_team_name: "Team B",
        status: "scheduled",
        kickoff_utc: "2026-10-15T20:00:00Z",
        last_odds_success_at: "2026-10-09T10:00:00Z",
      }],
    });
    const { fetchApostaOdds } = await import("@/lib/server/apostaProvider.server.js");
    fetchApostaOdds.mockResolvedValueOnce({ markets: [], health: { status: "unconfigured", error: "No endpoint" } });

    const result = await syncApostaOdds(db, "evt-200", "manual");
    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    const ev = db._stores.Event[0];
    expect(ev.last_odds_success_at).toBe("2026-10-09T10:00:00Z"); // unchanged
    expect(ev.odds_fetch_status).toContain("unconfigured");
  });
});

describe("6. Timeout / error does not rejuvenate odds", () => {
  it("preserves old success timestamp on degraded health", async () => {
    const db = createMockDb({
      Event: [{
        id: "evt-201",
        aposta_event_id: "ap-201",
        home_team_name: "Team A",
        away_team_name: "Team B",
        status: "scheduled",
        kickoff_utc: "2026-10-15T20:00:00Z",
        last_odds_success_at: "2026-10-09T10:00:00Z",
        last_odds_sync_at: "2026-10-09T10:00:00Z",
      }],
    });
    const { fetchApostaOdds } = await import("@/lib/server/apostaProvider.server.js");
    fetchApostaOdds.mockResolvedValueOnce({ markets: [], health: { status: "degraded", error: "ETIMEDOUT" } });

    const result = await syncApostaOdds(db, "evt-201", "manual");
    expect(result.failed).toBe(1);
    const ev = db._stores.Event[0];
    expect(ev.last_odds_success_at).toBe("2026-10-09T10:00:00Z");
    expect(ev.last_odds_sync_at).toBe("2026-10-09T10:00:00Z");
    expect(ev.odds_fetch_status).toContain("degraded");
  });
});

describe("7. Complete empty response marks old markets as missing", () => {
  it("healthy + no markets → old open markets become missing", async () => {
    const db = createMockDb({
      Event: [{
        id: "evt-202",
        aposta_event_id: "ap-202",
        home_team_name: "Team A",
        away_team_name: "Team B",
        status: "scheduled",
        kickoff_utc: "2026-10-15T20:00:00Z",
      }],
      Market: [{
        id: "mkt-1",
        event_id: "evt-202",
        market_key: "1x2",
        line: null,
        status: "open",
      }],
    });
    const { fetchApostaOdds } = await import("@/lib/server/apostaProvider.server.js");
    fetchApostaOdds.mockResolvedValueOnce({ markets: [], health: { status: "healthy", error: null } });

    const result = await syncApostaOdds(db, "evt-202", "manual");
    expect(result.processed).toBe(1);
    const mkt = db._stores.Market[0];
    expect(mkt.status).toBe("missing");
    const ev = db._stores.Event[0];
    expect(ev.odds_fetch_status).toBe("ok");
  });
});

describe("8. Suspended selection is saved as suspended", () => {
  it("stores selection_status = suspended from provider", async () => {
    const db = createMockDb({
      Event: [{ id: "evt-300", aposta_event_id: "ap-300", home_team_name: "A", away_team_name: "B", status: "scheduled", kickoff_utc: "2026-10-15T20:00:00Z" }],
      Market: [{ id: "mkt-300", event_id: "evt-300", market_key: "1x2", line: null, status: "open" }],
    });
    await recordOddsSnapshot(db, "evt-300", "1x2", "home", 2.0, null, "mkt-300", "suspended", "suspended", "2026-10-10T10:00:00Z");
    const snap = db._stores.OddsSnapshot[0];
    expect(snap.selection_status).toBe("suspended");
    expect(snap.market_status).toBe("suspended");
    const sel = db._stores.Selection[0];
    expect(sel.is_suspended).toBe(true);
    expect(sel.status).toBe("suspended");
  });
});

describe("9. Old manual odds stay old", () => {
  it("source_timestamp from old import is preserved, not rejuvenated", async () => {
    const db = createMockDb({
      Event: [{ id: "evt-400", aposta_event_id: "ap-400", home_team_name: "A", away_team_name: "B", status: "scheduled", kickoff_utc: "2026-10-15T20:00:00Z" }],
      Market: [{ id: "mkt-400", event_id: "evt-400", market_key: "1x2", line: null, status: "open" }],
    });
    const oldTs = "2026-10-01T12:00:00Z";
    await recordOddsSnapshot(db, "evt-400", "1x2", "home", 2.0, null, "mkt-400", "open", "open", oldTs);
    const snap = db._stores.OddsSnapshot[0];
    expect(snap.source_timestamp).toBe(oldTs);
    expect(snap.observed_at).toBe(oldTs);
    // retrieval_timestamp is the current time, separate from source
    expect(snap.retrieval_timestamp).not.toBe(oldTs);
  });
});

describe("10. Future observation timestamp is rejected", () => {
  it("implausibly future source_timestamp → observed_at stays null", async () => {
    const db = createMockDb({
      Event: [{ id: "evt-500", aposta_event_id: "ap-500", home_team_name: "A", away_team_name: "B", status: "scheduled", kickoff_utc: "2026-10-15T20:00:00Z" }],
      Market: [{ id: "mkt-500", event_id: "evt-500", market_key: "1x2", line: null, status: "open" }],
    });
    const futureTs = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await recordOddsSnapshot(db, "evt-500", "1x2", "home", 2.0, null, "mkt-500", "open", "open", futureTs);
    const snap = db._stores.OddsSnapshot[0];
    expect(snap.source_timestamp).toBeNull();
    expect(snap.observed_at).toBeNull();
  });
});

describe("11. Market update does not rejuvenate another market's selection", () => {
  it("updating market A odds does not change market B selection timestamp", async () => {
    const db = createMockDb({
      Event: [{ id: "evt-600", aposta_event_id: "ap-600", home_team_name: "A", away_team_name: "B", status: "scheduled", kickoff_utc: "2026-10-15T20:00:00Z" }],
      Market: [
        { id: "mkt-A", event_id: "evt-600", market_key: "1x2", line: null, status: "open" },
        { id: "mkt-B", event_id: "evt-600", market_key: "btts", line: null, status: "open" },
      ],
      Selection: [
        { id: "sel-A", market_id: "mkt-A", event_id: "evt-600", selection: "home", current_odds: 2.0, odds_updated_at: "2026-10-09T10:00:00Z", status: "open", is_suspended: false },
        { id: "sel-B", market_id: "mkt-B", event_id: "evt-600", selection: "yes", current_odds: 1.8, odds_updated_at: "2026-10-09T10:00:00Z", status: "open", is_suspended: false },
      ],
    });
    // Update only market A's selection
    await recordOddsSnapshot(db, "evt-600", "1x2", "home", 2.1, null, "mkt-A", "open", "open", "2026-10-10T12:00:00Z");
    const selB = db._stores.Selection.find((s) => s.id === "sel-B");
    expect(selB.odds_updated_at).toBe("2026-10-09T10:00:00Z"); // unchanged
    expect(selB.current_odds).toBe(1.8); // unchanged
  });
});

describe("12. Historical OddsSnapshots are not updated or deleted", () => {
  it("new snapshot is appended, old snapshot unchanged", async () => {
    const db = createMockDb({
      Event: [{ id: "evt-700", aposta_event_id: "ap-700", home_team_name: "A", away_team_name: "B", status: "scheduled", kickoff_utc: "2026-10-15T20:00:00Z" }],
      Market: [{ id: "mkt-700", event_id: "evt-700", market_key: "1x2", line: null, status: "open" }],
    });
    // First snapshot
    await recordOddsSnapshot(db, "evt-700", "1x2", "home", 2.0, null, "mkt-700", "open", "open", "2026-10-09T10:00:00Z");
    const firstSnap = { ...db._stores.OddsSnapshot[0] };
    // Second snapshot
    await recordOddsSnapshot(db, "evt-700", "1x2", "home", 2.2, null, "mkt-700", "open", "open", "2026-10-10T10:00:00Z");
    expect(db._stores.OddsSnapshot.length).toBe(2);
    // First snapshot unchanged
    expect(db._stores.OddsSnapshot[0].decimal_odds).toBe(firstSnap.decimal_odds);
    expect(db._stores.OddsSnapshot[0].source_timestamp).toBe(firstSnap.source_timestamp);
  });
});

describe("13. Import without stats creates no active recommendation", () => {
  it("signalEligibility suppresses when mapping unconfirmed and prediction not computed", () => {
    const event = {
      aposta_event_id: "ap-800",
      aposta_event_url: "https://aposta.la/event/800",
      status: "scheduled",
      is_locked: false,
      kickoff_utc: new Date(Date.now() + 86400000).toISOString(),
      last_odds_sync_at: new Date().toISOString(),
      mapping_status: "unmatched",
      mapping_confidence: 0,
      external_event_id: null,
    };
    const signal = { is_active: true, expected_value: 0.05 };
    const pred = { feature_snapshot: null }; // not computed
    const { eligible, reasons } = signalEligibility({ signal, event, prediction: pred, minEV: 0.03 });
    expect(eligible).toBe(false);
    expect(reasons).toContain("mapping_unconfirmed");
    expect(reasons).toContain("prediction_not_computed");
  });
});

describe("14. Dashboard and AI give no tips when recommendation chain is blocked", () => {
  it("filterEligibleSignals returns empty when no prediction computed", async () => {
    const { filterEligibleSignals } = await import("@/lib/server/signalFilter.js");
    const db = createMockDb({
      Event: [{
        id: "evt-900",
        aposta_event_id: "ap-900",
        aposta_event_url: "https://aposta.la/900",
        home_team_name: "A",
        away_team_name: "B",
        status: "scheduled",
        is_locked: false,
        kickoff_utc: new Date(Date.now() + 86400000).toISOString(),
        last_odds_sync_at: new Date().toISOString(),
        mapping_status: "matched",
        mapping_confidence: 0.9,
        external_event_id: "ext-900",
        provenance: "manual_import",
      }],
      ValueSignal: [{
        id: "sig-900",
        event_id: "evt-900",
        prediction_id: null,
        is_active: true,
        expected_value: 0.05,
        status: "value",
        market_key: "1x2",
        selection: "home",
      }],
    });
    const signals = await filterEligibleSignals(db, { limit: 10 });
    // Suppressed because prediction_id is null → prediction not computed
    expect(signals.length).toBe(0);
  });
});

// --- Additional: ensureMarket stores period and status ---
describe("ensureMarket stores period, status, provider IDs", () => {
  it("creates market with all fields", async () => {
    const db = createMockDb();
    const m = await ensureMarket(db, "evt-X", "over_under_goals", "Over/Under 2.5", 2.5, 1, "prov-1", "open", "full_time", "O/U 2.5 Goals");
    expect(m.period).toBe("full_time");
    expect(m.status).toBe("open");
    expect(m.provider_market_id).toBe("prov-1");
    expect(m.provider_market_name).toBe("O/U 2.5 Goals");
  });
});