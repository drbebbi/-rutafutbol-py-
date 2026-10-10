// API-Football is the only implemented adapter. Sportmonks is NOT_IMPLEMENTED.
import { secrets } from "base44:runtime";
import { normalizeFixture, normalizeTeamMatch, normalizeLineup, normalizeInjury } from "@/lib/server/apiFootballAdapter";
export function configurationStatus() {
  if (secrets.get("API_FOOTBALL_KEY")) return { status: "healthy", provider: "api_football" };
  return { status: "unconfigured", reason: secrets.get("SPORTMONKS_API_KEY") ? "SPORTMONKS_NOT_IMPLEMENTED" : "API_FOOTBALL_KEY_MISSING" };
}
export const isConfigured = () => configurationStatus().status === "healthy";
async function request(path, params = {}) {
  const config = configurationStatus();
  if (!isConfigured()) throw new Error(config.reason);
  const url = new URL(`https://v3.football.api-sports.io/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": secrets.get("API_FOOTBALL_KEY") }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`API_FOOTBALL_HTTP_${res.status}`);
  const json = await res.json();
  if (!json || (json.errors && Object.keys(json.errors).length)) throw new Error("API_FOOTBALL_RESPONSE_ERROR");
  if (json.paging?.total > 1) throw new Error("PROVIDER_PAGINATION_REQUIRES_NARROWER_QUERY");
  return json.response;
}
async function rows(path, params) {
  const response = await request(path, params);
  if (!Array.isArray(response)) throw new Error("INVALID_PROVIDER_RESPONSE");
  return response;
}
export async function getFixturesByDate(dateISO) {
  const ts = new Date().toISOString();
  return { fixtures: (await rows("fixtures", { date: dateISO, timezone: "UTC" })).map((r) => normalizeFixture(r, ts)), source: "api_football" };
}
export async function getFixture(externalId) {
  if (!/^\d+$/.test(String(externalId))) throw new Error("INVALID_EXTERNAL_ID");
  const raw = await rows("fixtures", { id: externalId });
  if (raw.length !== 1) throw new Error("EXTERNAL_FIXTURE_NOT_FOUND");
  return normalizeFixture(raw[0], new Date().toISOString());
}
export async function getTeamLastMatches(teamId, limit = 10) {
  const ts = new Date().toISOString();
  return { matches: (await rows("fixtures", { team: teamId, last: Math.min(limit, 10), status: "FT", timezone: "UTC" }))
    .map((r) => normalizeTeamMatch(r, teamId, ts)).filter(Boolean), source: "api_football" };
}
export async function getLineups(fixture) {
  const ts = new Date().toISOString();
  return { lineups: (await rows("fixtures/lineups", { fixture })).map((r) => normalizeLineup(r, ts)), source: "api_football" };
}
export async function getInjuries(fixture) {
  const ts = new Date().toISOString();
  return { injuries: (await rows("injuries", { fixture })).map((r) => normalizeInjury(r, ts)), source: "api_football" };
}
export async function getStandings(league, season) {
  const response = await rows("standings", { league, season });
  return { standings: response.flatMap((r) => r.league?.standings?.flat() || []).map((r) => ({ external_team_id: String(r.team.id), position: r.rank, points: r.points, played: r.all.played, goal_difference: r.goalsDiff })), source: "api_football" };
}
export async function testConnection() {
  if (!isConfigured()) return { ...configurationStatus(), error: configurationStatus().reason };
  const start = Date.now();
  try { await request("status"); return { status: "healthy", latency_ms: Date.now() - start, provider: "api_football" }; }
  catch (e) { return { status: "offline", error: e.message, latency_ms: Date.now() - start }; }
}
export const FOOTBALL_DATA_PROVIDERS = ["api_football"];