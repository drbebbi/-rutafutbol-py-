// In-memory stand-in for the Base44 entities client used by pipeline tests.
// Supports the query operators the code uses ($in, $nin, $ne, $gte, $lt,
// $exists, $regex, $or) and dotted paths ("external_ids.football_data_id").
import { vi } from "vitest";

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

// --- Mock DB client ---
export function matchesQuery(record, query) {
  if (!query) return true;
  for (const [key, value] of Object.entries(query)) {
    if (key === "$or") {
      if (!value.some((q) => matchesQuery(record, q))) return false;
    } else if (key === "id" || key === "_id") {
      if (Array.isArray(value)) {
        if (!value.includes(record.id)) return false;
      } else if (value && typeof value === "object") {
        if (value.$in && !value.$in.includes(record.id)) return false;
      } else if (record.id !== value) return false;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      record = { ...record, [key]: getPath(record, key) };
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
      if (getPath(record, key) !== value) return false;
    }
  }
  return true;
}

export function createMockDb(initialData = {}) {
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

