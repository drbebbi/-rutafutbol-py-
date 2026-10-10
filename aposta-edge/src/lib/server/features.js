export const MIN_TEAM_SAMPLE = 6;
const nonnegative = (v) => Number.isFinite(v) && v >= 0;
export function validateFeatures(features) {
  const reasons = [];
  if (!features?.as_of || !Number.isFinite(Date.parse(features.as_of))) reasons.push("MISSING_AS_OF");
  for (const side of ["home", "away"]) {
    const f = features?.[side];
    if (!f || f.sample_size < MIN_TEAM_SAMPLE || !nonnegative(f.avg_goals) || !nonnegative(f.avg_goals_conceded) ||
        !Array.isArray(f.source_record_ids) || new Set(f.source_record_ids).size !== f.sample_size) reasons.push(`INSUFFICIENT_DATA_${side.toUpperCase()}`);
  }
  return { valid: reasons.length === 0, reasons };
}
export function featuresFromRecords(home, away, asOf, kickoff) {
  const features = { as_of: asOf, minimum_sample: MIN_TEAM_SAMPLE };
  for (const [side, records] of [["home", home], ["away", away]]) {
    const seen = new Set();
    const rows = records.filter((s) => {
      const key = `${s.source}:${s.external_fixture_id}:${s.team_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return s.verified === true && s.source === "api_football" && s.external_fixture_id && s.id &&
        Date.parse(s.played_at) < Date.parse(kickoff) && Date.parse(s.played_at) < Date.parse(asOf) &&
        Date.parse(s.retrieved_at) <= Date.parse(asOf) && Date.parse(s.known_at) <= Date.parse(asOf) &&
        nonnegative(s.goals) && nonnegative(s.goals_conceded);
    }).slice(0, 10);
    const mean = (field) => rows.length ? rows.reduce((a, r) => a + r[field], 0) / rows.length : null;
    features[side] = { sample_size: rows.length, avg_goals: mean("goals"), avg_goals_conceded: mean("goals_conceded"), source_record_ids: rows.map((r) => r.id) };
  }
  return features;
}
export function featureLambdas(features) {
  const validation = validateFeatures(features);
  if (!validation.valid) throw new Error(validation.reasons.join(","));
  return { lambdaHome: (features.home.avg_goals + features.away.avg_goals_conceded) / 2,
    lambdaAway: (features.away.avg_goals + features.home.avg_goals_conceded) / 2 };
}