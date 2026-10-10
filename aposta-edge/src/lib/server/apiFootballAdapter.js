// API-Football v3.9.3: official documentation-v3 / public/doc/openapi.yaml.
const id = (v) => v == null ? null : String(v);
export function normalizeFixture(raw, retrievedAt) {
  const f = raw.fixture, teams = raw.teams, league = raw.league;
  if (!f?.id || !teams?.home?.id || !teams?.away?.id || !league?.id || !Number.isFinite(Date.parse(f.date))) throw new Error("INVALID_EXTERNAL_FIXTURE");
  const finished = f.status?.short === "FT"; // Only regulation-time FT; AET/PEN intentionally not settled as FT.
  return { provider: "api_football", external_event_id: id(f.id), external_home_team_id: id(teams.home.id),
    external_away_team_id: id(teams.away.id), external_competition_id: id(league.id),
    home_team_name: teams.home.name, away_team_name: teams.away.name, competition_name: league.name,
    kickoff_utc: new Date(f.date).toISOString(), season: league.season, provider_status: f.status?.short,
    status: finished ? "finished" : f.status?.short === "NS" ? "scheduled" : "unavailable",
    home_score: raw.score?.fulltime?.home, away_score: raw.score?.fulltime?.away,
    result_confirmed: finished && Number.isInteger(raw.score?.fulltime?.home) && raw.score.fulltime.home >= 0 && Number.isInteger(raw.score?.fulltime?.away) && raw.score.fulltime.away >= 0,
    retrieved_at: retrievedAt };
}
export function normalizeTeamMatch(raw, teamId, retrievedAt) {
  const f = normalizeFixture(raw, retrievedAt);
  if (!f.result_confirmed) return null;
  const isHome = f.external_home_team_id === String(teamId);
  if (!isHome && f.external_away_team_id !== String(teamId)) throw new Error("STAT_TEAM_MISMATCH");
  return { external_fixture_id: f.external_event_id, external_team_id: String(teamId),
    external_opponent_id: isHome ? f.external_away_team_id : f.external_home_team_id, is_home: isHome,
    goals: isHome ? f.home_score : f.away_score, goals_conceded: isHome ? f.away_score : f.home_score,
    played_at: f.kickoff_utc, known_at: retrievedAt, retrieved_at: retrievedAt, source: "api_football", verified: true, data_quality: "partial" };
}
export function normalizeLineup(raw, retrievedAt) {
  if (!raw.team?.id || !Array.isArray(raw.startXI)) throw new Error("INVALID_LINEUP");
  return { external_team_id: String(raw.team.id), formation: raw.formation || null,
    players: raw.startXI.map((p) => p.player), confirmed: raw.startXI.length === 11, retrieved_at: retrievedAt };
}
export function normalizeInjury(raw, retrievedAt) {
  if (!raw.team?.id || !raw.player?.id) throw new Error("INVALID_INJURY");
  return { external_team_id: String(raw.team.id), external_player_id: String(raw.player.id), player_name: raw.player.name,
    reason: raw.player.reason, status: /suspension/i.test(raw.player.type || "") ? "suspended" : "out", retrieved_at: retrievedAt };
}