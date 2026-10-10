// Manual capture of Aposta.la odds by an admin who reads them on aposta.la.
// Pure: turns the capture form into the canonical manual-import payload.
//
// Why manual: aposta.la disallows automated access to /api/ (robots.txt) and
// protects the site with Cloudflare Turnstile. The platform does not scrape it.
// A human reading the public page and typing the prices is the lawful path
// until Aposta provides an official data feed.

export const ASUNCION_TZ = "America/Asuncion";
export const MAX_OVERROUND = 1.25; // > 25 % margin almost always means a typo
export const MIN_ODDS = 1.01;
export const MAX_ODDS = 1000;

// The Aposta event id is taken from the event URL (last run of digits).
export function parseApostaEventId(url) {
  try {
    const u = new URL(String(url || "").trim());
    if (u.protocol !== "https:" || !/^(www\.)?aposta\.la$/i.test(u.hostname)) return null;
    const ids = `${u.pathname}${u.hash}`.match(/\d{3,}/g);
    return ids ? ids[ids.length - 1] : null;
  } catch { return null; }
}

// Offset (ms) of a time zone at a UTC instant, via Intl (handles DST changes).
function tzOffsetMs(utcMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

// "2026-10-12T19:30" in Asunción local time → ISO UTC string.
export function localToUtc(local, timeZone = ASUNCION_TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ""));
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = guess - tzOffsetMs(guess, timeZone);
  const utc = guess - tzOffsetMs(first, timeZone);
  return new Date(utc).toISOString();
}

const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

const MARKETS = [
  { key: "1x2", line: null, fields: [["home", "odds_home"], ["draw", "odds_draw"], ["away", "odds_away"]], label: "1X2" },
  { key: "over_under", line: 2.5, fields: [["over", "odds_over25"], ["under", "odds_under25"]], label: "Más/Menos 2,5" },
  { key: "btts", line: null, fields: [["yes", "odds_btts_yes"], ["no", "odds_btts_no"]], label: "Ambos marcan" },
];

// form: { event_url, home_team, away_team, competition, kickoff_local,
//         odds_home, odds_draw, odds_away, odds_over25, odds_under25,
//         odds_btts_yes, odds_btts_no, confirmed_now }
export function buildCapturePayload(form, observedAt = new Date().toISOString()) {
  const errors = [];
  const eventId = parseApostaEventId(form?.event_url);
  if (!eventId) errors.push("URL de Aposta inválida (debe ser https://aposta.la/… con el número del evento)");
  const home = String(form?.home_team || "").trim();
  const away = String(form?.away_team || "").trim();
  if (!home || !away) errors.push("Faltan los equipos");
  if (home && away && home.toLowerCase() === away.toLowerCase()) errors.push("Local y visitante son el mismo equipo");
  const kickoff = localToUtc(form?.kickoff_local);
  if (!kickoff) errors.push("Fecha/hora de inicio inválida");
  else if (Date.parse(kickoff) <= Date.parse(observedAt)) errors.push("El partido ya empezó: solo se capturan cuotas pre-partido");
  if (form?.confirmed_now !== true) errors.push("Confirma que acabas de leer estas cuotas en aposta.la");

  const markets = [];
  for (const m of MARKETS) {
    const values = m.fields.map(([, f]) => num(form?.[f]));
    if (values.every((v) => v == null)) continue; // market not captured
    if (values.some((v) => v == null)) { errors.push(`${m.label}: faltan cuotas (todas las opciones o ninguna)`); continue; }
    if (values.some((v) => Number.isNaN(v) || v < MIN_ODDS || v > MAX_ODDS)) { errors.push(`${m.label}: cuota fuera de rango`); continue; }
    const overround = values.reduce((a, v) => a + 1 / v, 0);
    if (overround < 1 || overround > MAX_OVERROUND) { errors.push(`${m.label}: margen ${((overround - 1) * 100).toFixed(1)} % no plausible, revisa las cuotas`); continue; }
    markets.push({
      market_key: m.key, line: m.line, period: "full_time", status: "open", source_timestamp: observedAt,
      selections: m.fields.map(([sel], i) => ({ selection: sel, odds: values[i], status: "open" })),
    });
  }
  if (markets.length === 0) errors.push("Captura al menos un mercado completo");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      aposta_event_id: eventId, event_url: String(form.event_url).trim(), home_team_name: home, away_team_name: away,
      competition_name: String(form?.competition || "").trim() || null, kickoff_utc: kickoff, status: "scheduled",
      source_timestamp: observedAt, markets,
    },
  };
}
