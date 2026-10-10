import { describe, it, expect, vi } from "vitest";
import { createMockDb } from "./helpers/mockDb.js";
import { parseApostaEventId, localToUtc, buildCapturePayload } from "@/lib/apostaCapture.js";

vi.mock("@/lib/server/apostaProvider.server.js", () => ({ APOSTA_PROVIDER_NAME: "APOSTA" }));
vi.mock("@/lib/server/footballDataProvider.server.js", () => ({ isConfigured: () => false }));

const NOW = "2026-10-10T18:00:00.000Z";
const form = (over = {}) => ({
  event_url: "https://aposta.la/bets#event/1023456", home_team: "Olimpia", away_team: "Cerro Porteño", competition: "Primera División",
  kickoff_local: "2026-10-12T19:30", odds_home: "2,10", odds_draw: "3.30", odds_away: "3.60",
  odds_over25: "", odds_under25: "", odds_btts_yes: "1.85", odds_btts_no: "1.90", confirmed_now: true, ...over,
});

describe("Aposta capture form", () => {
  it("takes the event id from an https aposta.la URL only", () => {
    expect(parseApostaEventId("https://aposta.la/bets#event/1023456")).toBe("1023456");
    expect(parseApostaEventId("https://www.aposta.la/es/sports/event/987654?x=1")).toBe("987654");
    expect(parseApostaEventId("https://aposta.la.fake.com/event/1023456")).toBeNull();
    expect(parseApostaEventId("http://aposta.la/event/1023456")).toBeNull();
  });
  it("converts Asunción local time to UTC", () => {
    expect(localToUtc("2026-10-12T19:30")).toBe("2026-10-12T22:30:00.000Z");
    expect(localToUtc("2026-10-12T19:30", "UTC")).toBe("2026-10-12T19:30:00.000Z");
    expect(localToUtc("12.10.2026 19:30")).toBeNull();
  });
  it("builds the canonical payload with the server observation time", () => {
    const r = buildCapturePayload(form(), NOW);
    expect(r.ok).toBe(true);
    expect(r.payload).toMatchObject({ aposta_event_id: "1023456", kickoff_utc: "2026-10-12T22:30:00.000Z", source_timestamp: NOW });
    expect(r.payload.markets.map((m) => m.market_key)).toEqual(["1x2", "btts"]); // empty O/U skipped
    expect(r.payload.markets[0].selections[0]).toEqual({ selection: "home", odds: 2.1, status: "open" }); // comma decimal accepted
  });
  it("rejects typos, half-filled markets, past kickoffs and unconfirmed captures", () => {
    expect(buildCapturePayload(form({ odds_draw: "33" }), NOW).errors.join()).toMatch(/margen|1X2/);
    expect(buildCapturePayload(form({ odds_draw: "1.2" }), NOW).errors.join()).toMatch(/margen/);
    expect(buildCapturePayload(form({ odds_over25: "1.9" }), NOW).errors.join()).toMatch(/faltan cuotas/);
    expect(buildCapturePayload(form({ kickoff_local: "2026-10-09T19:30" }), NOW).errors.join()).toMatch(/ya empezó/);
    expect(buildCapturePayload(form({ confirmed_now: false }), NOW).errors.join()).toMatch(/Confirma/);
    expect(buildCapturePayload(form({ odds_home: "", odds_draw: "", odds_away: "", odds_btts_yes: "", odds_btts_no: "" }), NOW).errors.join()).toMatch(/al menos un mercado/);
  });
});

describe("capture → stored, verified, fresh Aposta odds", () => {
  it("passes the provenance gate and gives every price a source time", async () => {
    const { importApostaEventManual, verifyManualEvent } = await import("@/lib/server/syncPipeline.server.js");
    const { hasVerifiableProvenance, isOddsFresh } = await import("@/lib/server/provenance.js");
    const db = createMockDb();
    const now = new Date().toISOString();
    const f = form({ kickoff_local: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 16) });
    const { payload } = buildCapturePayload(f, now);
    const ev = await importApostaEventManual(db, payload);
    expect(hasVerifiableProvenance(db._stores.Event[0])).toBe(false); // not yet verified
    await verifyManualEvent(db, ev.id, "admin-1");
    expect(hasVerifiableProvenance(db._stores.Event[0])).toBe(true);
    expect(db._stores.Selection).toHaveLength(5);
    expect(db._stores.Selection.every((s) => s.odds_observed_at === now && isOddsFresh(s.odds_observed_at) && s.current_snapshot_id)).toBe(true);
    expect(db._stores.Market.every((m) => m.status === "open")).toBe(true);
  });
});
