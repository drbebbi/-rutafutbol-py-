// Event matching / entity-resolution engine.
// Resolves Aposta team & competition names to external-provider entities
// using normalised names, aliases, competition, kickoff time and home/away.
// Produces a confidence score; ambiguous matches below threshold stay unmatched.

// Normalise a name: lowercase, strip accents/diacritics, punctuation, corp suffixes.
export function normaliseName(name) {
  if (!name) return "";
  let s = String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[.\-_/\\]/g, " ").replace(/\s+/g, " ").trim();
  const suffixes = ["fc", "cf", "sc", "ac", "ca", "afc", "cd", "club", "de", "sa", "inc"];
  const tokens = s.split(" ").filter((t) => t.length > 0 && !suffixes.includes(t));
  return tokens.join(" ");
}

// Token-based similarity (Jaccard on word sets) with bonus for substring containment.
export function nameSimilarity(a, b) {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const sa = new Set(na.split(" "));
  const sb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  let score = union > 0 ? inter / union : 0;
  if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.9);
  return score;
}

// Time proximity score: exact minute = 1, within 2h = 0.9, same day = 0.6.
export function timeProximity(t1, t2) {
  if (!t1 || !t2) return 0;
  const d1 = new Date(t1).getTime();
  const d2 = new Date(t2).getTime();
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return 0;
  const diffMin = Math.abs(d1 - d2) / 60000;
  if (diffMin <= 2) return 1;
  if (diffMin <= 120) return 0.9;
  if (diffMin <= 1440) return 0.6;
  return 0.2;
}

// Compute a composite confidence 0..1 for matching an Aposta event to a candidate.
export function matchConfidence(apostaEvent, candidate, factors = {}) {
  const homeSim = nameSimilarity(apostaEvent.home_team_name, candidate.home_team_name);
  const awaySim = nameSimilarity(apostaEvent.away_team_name, candidate.away_team_name);
  const compSim = nameSimilarity(apostaEvent.competition_name, candidate.competition_name);
  const timeSim = timeProximity(apostaEvent.kickoff_utc, candidate.kickoff_utc);

  // Home/away orientation must match (both have home first).
  const orientationOk = homeSim > 0.5 && awaySim > 0.5;

  const teamScore = (homeSim + awaySim) / 2;
  const confidence =
    0.5 * teamScore + 0.2 * compSim + 0.3 * timeSim;

  return {
    confidence: orientationOk ? confidence : confidence * 0.4,
    factors: { homeSim, awaySim, compSim, timeSim, orientationOk, ...factors },
  };
}

export const SAFE_THRESHOLD = 0.85;
export const AMBIGUOUS_THRESHOLD = 0.6;
export const MIN_CANDIDATE_GAP = 0.08;

export function rankFixtures(event, fixtures) {
  const ranked = fixtures.map((fixture) => ({ fixture, ...matchConfidence(event, fixture) }))
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  const gap = best ? best.confidence - (ranked[1]?.confidence ?? 0) : 0;
  const confirmed = !!best && best.confidence >= SAFE_THRESHOLD && gap >= MIN_CANDIDATE_GAP && best.factors.timeSim === 1 && best.factors.orientationOk;
  return { best, gap, confirmed, reason: confirmed ? null : gap < MIN_CANDIDATE_GAP ? "AMBIGUOUS_FIXTURES" : "FIXTURE_NOT_CONFIRMED" };
}

// Resolve a team name to a Team record using aliases first, then fuzzy name match.
export async function resolveTeam(base44, name, sport = "football") {
  if (!name) return null;
  const norm = normaliseName(name);
  // 1. alias lookup (exact normalised)
  const aliasPage = await base44.entities.TeamAlias.filter(
    { normalised_name: norm },
    { limit: 5 }
  );
  for (const a of aliasPage.items || []) {
    const team = await base44.entities.Team.get(a.team_id).catch(() => null);
    if (team) return { team, via: "alias", confidence: 1 };
  }
  // 2. fuzzy name match
  const page = await base44.entities.Team.filter({ sport }, { limit: 200 });
  let best = null;
  for (const t of page.items || []) {
    const sim = nameSimilarity(name, t.name);
    if (!best || sim > best.sim) best = { team: t, sim, via: "fuzzy" };
  }
  if (best && best.sim >= SAFE_THRESHOLD) return { team: best.team, via: best.via, confidence: best.sim };
  return null;
}

// Resolve a competition similarly.
export async function resolveCompetition(base44, name, country = null) {
  if (!name) return null;
  const norm = normaliseName(name);
  const aliasPage = await base44.entities.CompetitionAlias.filter(
    { normalised_name: norm },
    { limit: 5 }
  );
  for (const a of aliasPage.items || []) {
    const comp = await base44.entities.Competition.get(a.competition_id).catch(() => null);
    if (comp) return { competition: comp, via: "alias", confidence: 1 };
  }
  const page = await base44.entities.Competition.filter({}, { limit: 200 });
  let best = null;
  for (const c of page.items || []) {
    const sim = nameSimilarity(name, c.name);
    if (!best || sim > best.sim) best = { competition: c, sim, via: "fuzzy" };
  }
  if (best && best.sim >= SAFE_THRESHOLD) return { competition: best.competition, via: best.via, confidence: best.sim };
  return null;
}

// Persist a manual alias so future matching improves.
export async function addTeamAlias(base44, teamId, alias, provider = "manual") {
  return base44.entities.TeamAlias.create({
    team_id: teamId,
    alias,
    provider,
    normalised_name: normaliseName(alias),
    is_manual: true,
  });
}

export async function addCompetitionAlias(base44, competitionId, alias, provider = "manual") {
  return base44.entities.CompetitionAlias.create({
    competition_id: competitionId,
    alias,
    provider,
    normalised_name: normaliseName(alias),
    is_manual: true,
  });
}