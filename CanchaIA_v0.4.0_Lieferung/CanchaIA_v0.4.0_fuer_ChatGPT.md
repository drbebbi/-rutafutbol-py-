# CanchaIA v0.4.0 – Zusammenfassung für ChatGPT

Enthält: Änderungsbericht, Testbericht, offene Blocker, Startanleitung und den vollständigen Code-Diff gegenüber v0.3.4 (ohne Lockfiles und Bilder).

---

<!-- Datei: CHANGES_v0.4.0.md -->
# CanchaIA v0.4.0 – Änderungsbericht (kontrollierter Live-Pilot)

Grundlage: das gelieferte Archiv `CanchaIA_v0.3.4_iPhone_Codespaces_Ready.zip`, Paketversion **0.3.4**. Im Auftrag stand v0.3.3 mit 137 Tests. Das Archiv enthielt jedoch v0.3.4 mit **139** Tests.
Am bestehenden Code gearbeitet. Architektur, Marke, Design, Sprachen (ES Standard, DE, EN), Zeitzone America/Asuncion, Authentifizierung, CSRF, Rollen, Mock-Trennung und Zahlungsprüfung bleiben erhalten.

**Status: kontrollierter Pilotbetrieb.** Diese Version ist **nicht** produktionsreif und **nicht** als profitabel nachgewiesen. Es gibt weder einen echten Quoten-Live-Test noch einen Validierungsnachweis mit echten historischen Daten (siehe [OPEN_BLOCKERS.md](OPEN_BLOCKERS.md)).

## 0. Ist-Zustand vor den Änderungen

| Prüfung | Ergebnis (v0.3.4, Node 22.22.0) |
|---|---|
| Backend-Build (tsc) | erfolgreich |
| Frontend-Build (esbuild) | erfolgreich (keine Typprüfung im Build) |
| Backend-Tests | **139/139 bestanden** |
| Lockfiles | fehlten (keine reproduzierbare Installation) |
| Frontend-Typprüfung | nicht vorhanden |

Die Reproduktionstests wurden **vor** jeder Korrektur gegen den unveränderten v0.3.4-Code ausgeführt. Die Ausgaben liegen in `docs/test-evidence/` (`repro_v034.txt`, `p2_baseline.txt`, `old_validation_bigleague.txt`).

## 1. Befunde

Einordnung: **B** = bestätigter Fehler (reproduziert und mit Regressionstest abgesichert) · **V** = begründeter Befund (aus dem Code belegt, Test nach der Korrektur) · **G** = geprüft, kein Fehler · **E** = gewünschte Verbesserung.

### Priorität 1 – Berechnung und Speicherung

| # | Typ | Befund | Nachweis | Korrektur |
|---|---|---|---|---|
| 1.1 | **B** | `ValueBettingEngine.persist()` hielt ein Signal für unverändert, sobald `prediction_id`, `status` und `best_snapshot_id` gleich blieben. Geänderte Marktreferenz, Modellgewicht, Strategie, EV oder `decision_prob` wurden verworfen. | 3 von 4 Regressionstests schlugen auf v0.3.4 fehl, z. B. „gespeichert 0.38292…, berechnet 0.38286…“ | Signatur `calc_signature` über alle Berechnungswerte und Eingaben (Prognose, beste Quote und Buchmacher, Marktreferenz und Quelle, Anzahl Buchmacher, p_model, p_dec, Gewicht, Untergrenze, EV, Edge, Status, Konfiguration). Nur bei identischer Signatur werden `validated_at`, `valid_until` und `quality_score` fortgeschrieben. Bei Ersatz wird ein nachvollziehbarer Grund gespeichert. Eingefrorene `prediction_outcomes` bleiben unberührt (Test). |
| 1.2 | **B** | Der Cache-Schlüssel `leagueFits` bestand aus Anzahl, letzter Event-ID und Stunde. Korrigierte Ergebnisse oder xG-Werte erzeugten innerhalb der Stunde keinen neuen Fit. Wegen gleichem `inputsHash` wurde die **alte** Prognose-ID mit dem **neuen** Ergebnis zurückgegeben, gespeichert und zurückgegeben wichen also voneinander ab. | Regressionstests „korrigiertes Ergebnis“ und „korrigierte xG“ schlugen fehl | Inhalts-Hash aller Modelleingaben (Spiel, Anstoß, Teams, Tore, neutraler Platz, xG). `inputsHash` enthält zusätzlich Gewichte und das Ergebnis selbst. |
| 1.3 | **B** | Folgebefund: Der bestehende Idempotenztest bestand **nur wegen 1.2**. Der Mock lädt je Lauf weitere xG-Statistiken nach, die Eingaben änderten sich also tatsächlich. | Gegenprobe: 2. Lauf erhöht xG-Abdeckung von 0,81 auf 0,94 | Test hält die Eingaben konstant. Neuer Test: neue Daten führen zu einer neuen Prognose. |

### Priorität 2 – Backtest und Validierung

| # | Typ | Befund | Nachweis | Korrektur |
|---|---|---|---|---|
| 2.1 | **B** | Beim Aufbau der Backtest-Ensembles gingen die λ-Werte verloren, und die Stichprobengröße war fest 30. Dadurch fehlte der Stichprobenterm, die Unsicherheit war kleiner als live, und mehr Wetten qualifizierten sich. | `p2_baseline.txt`: Backtest-sd = sd ohne λ (0,0424) | `Row.outputs` behält die vollständigen Modellausgaben. `combine(outputs, weights, min(Teamspiele))` arbeitet wie live. |
| 2.2 | **B** | Die Wettsimulation ≠ Live-Auswahl: keine Datenqualitätsregel, keine AVOID-Regel, z fest 1, mehrere Wetten je Spiel, kein Top-5-Limit. | v0.3.4: 13 Spiele mit 2 Wetten; große Testliga 645 Wetten → jetzt 373 | Eine Entscheidungsregel `decide()` (value.ts) und eine Auswahlregel `selectTop()` (recommendation.ts) für Live **und** Backtest. Auswahlfenster = Kalendertag des Entscheidungszeitpunkts (America/Asuncion), höchstens 5 je Fenster, höchstens 1 je Spiel. Ausgeschlossene Signale werden je Grund gezählt. |
| 2.3 | **B** | Informationsstand: Der Backtest nutzte alle Spiele mit „Anstoß vor Zielspiel“, also auch Spiele, die zum Entscheidungszeitpunkt (Anstoß − 60 min) noch liefen. | Test `knownAt`; dichter Spielplan (1 h Abstand) | Ein Ergebnis gilt erst 150 min nach Anstoß als bekannt (`RESULT_AVAILABLE_AFTER_MS`). Fit-Daten = Ergebnisse, die zum frühesten Entscheidungszeitpunkt des Fensters bekannt waren. Datenqualität im Backtest über dieselbe Funktion wie live (`computeDataQuality`, Aufstellungen = keine). |
| 2.4 | **V** | Geschätzte CSV-Quotenzeitpunkte (Anstoß − 24 h) waren im Ergebnis nicht als solche erkennbar. | Code (`footballDataCsv.ts`, `backtest.ts`) | `oddsTimes.estimatedShare`, Hinweis „GESCHÄTZT“ in der Simulation, `oddsTimesEstimated` je Bereich, Spalte im Bericht. |
| 2.5 | **B** | Der Validierungsstatus war global: Fehlende BTTS-Historie oder ein einzelner gescheiterter Markt blockierte **alle** Märkte. | `old_validation_bigleague.txt`: gesamt FAILED (OU-ECE, BTTS ohne Quoten); neu: 1X2 VALIDATED, OU FAILED, BTTS UNVALIDATED | Status je **Wettbewerb × Markt** (`model_scope_validations`, unveränderlich). Gesamtstatus VALIDATED nur, wenn alle Bereiche bestehen, sonst PARTIAL. Hinweis: Der 1X2-Befund dieser synthetischen Liga liegt knapp an der Grenze (95-%-KI-Obergrenze −0,0001). Er ist ein Logiktest, kein Qualitätsnachweis. |
| 2.6 | **V** | `currentModelVersion()` übernahm die neueste **global** validierte Version für **alle** Wettbewerbe. | Code `prediction/index.ts` | Version und Gewichte nur, wenn für genau diesen Wettbewerb ein VALIDATED-Bereich existiert, und nur für die validierten Märkte. Alte globale Versionen ohne Bereichseinträge gelten nicht mehr (Test). |
| 2.7 | **V** | Die Freigaberegel prüfte „Mischung nicht signifikant schlechter als der Markt“. Der Bericht schrieb aber „mit Mehrwert gegenüber dem Markt“. | Code `backtest.ts` (Zeile 261 alt) | `marketEvidence`: BETTER / NOT_WORSE / WORSE / NOT_TESTABLE. Der Text sagt ausdrücklich „KEIN Nachweis eines Mehrwerts“. **STRONG_VALUE** verlangt jetzt validiert **und** BETTER. |
| 2.8 | **V** | Der Scheduler rief `BacktestingEngine` direkt auf, ohne Datenqualitätsprüfung. Dasselbe galt für `POST /api/backtest/run` ohne Scheduler und `npm run backtest`. | Code `scheduler.ts:35`, `server.ts`, `cli.ts` | Alle Wege laufen über `runValidation()` (Datenqualität → Backtest → Bericht). Blocker gelten nur für den betroffenen Wettbewerb. Strategie, Mindest-EV und Gewicht kommen aus den Systemeinstellungen (Test). |

### Priorität 3 – The Odds API und Credit-Kontrolle

Offizielle Doku (https://the-odds-api.com/liveapi/guides/v4/) geprüft: `/sports` und `/events` sind kostenlos. `/odds` kostet Märkte × Regionen. `/scores` mit `daysFrom` kostet 2. Event-Odds kosten gelieferte Märkte × Regionen, leere Antworten sind kostenlos. Header: `x-requests-remaining/-used/-last`.

| # | Typ | Befund | Nachweis | Korrektur |
|---|---|---|---|---|
| 3.1 | **B** | Die Cache-Schlüssel enthielten sekundengenaue Zeitfenster. Jeder Lauf erzeugte einen neuen Schlüssel, Cache-Treffer waren praktisch unmöglich, und `api_cache` wuchs. | Repro: 2 statt 1 `/events`-Abruf im Abstand von 2 min | Fenster auf volle Stunden gerundet (`hourWindow`), Ergebnis exakt nachgefiltert. |
| 3.2 | **B** | `lastEvents`: Gecachte Quotenantworten konnten bei Fremd-Fixtures bereits begonnene oder außerhalb des Fensters liegende Spiele liefern. | Repro: Spiel „started“ wurde übernommen | Nur Spiele im Fenster, die noch nicht begonnen haben. Der Speicher wird nach jedem Lauf geleert. Die Provider-Uhr folgt der Queue-Uhr. |
| 3.3 | **B** | Ergebnisse wurden je Spiel gesucht, über alle Sport-Keys. Dadurch gab es `/scores`-Abrufe (2 Credits) auch für Wettbewerbe ohne offene Spiele und für Spiele älter als 3 Tage. | Repro: 2 statt 1 `/scores`-Abruf | `resultsFor()`: ein Abruf je Wettbewerb mit offenen Spielen der letzten 3 Tage. |
| 3.4 | **B** | Bei nicht ausreichendem Budget brach der Quotenlauf **mittendrin** ab: Wettbewerb 1 wurde bezahlt, Wettbewerb 2 abgelehnt. | alter Test V1 erwartete genau diesen Abbruch | Prüfung **vor** dem ersten kostenpflichtigen Abruf: Minimum aus Tagesbudget, Monatsbudget und Anbieter-Restcredits. Die nächsten Anstöße kommen zuerst, der Rest wird mit Grund übersprungen. Ohne Budget gibt es keinen Abruf. |
| 3.5 | **E** | Spielsuche und Quoten liefen im selben Intervall. | – | Eigener Job `discovery` (kostenlos, `THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES`, Standard 30, mindestens 10) und `hourly_sync` für Quoten und Analyse (`THE_ODDS_API_ODDS_INTERVAL_MINUTES`, Standard 60, mindestens 15). |
| 3.6 | **E** | Die Admin-Anzeige zeigte nicht getrennt, was tatsächlich belegt ist. | – | Nachweise getrennt: Verbindung (kostenlos), Spielsuche (kostenlos), Quoten (kostenpflichtig, nur mit gespeicherten gültigen Snapshots), Prognosen mit echten Quoten. Dazu letzter echter Abruf (HTTP-Status, Endpunkt, Credits), Datenalter, Credits und nächste geplante Läufe. Ein bestandener Verbindungstest erscheint ausdrücklich **nicht** als Quoten- oder Prognose-Nachweis. |
| 3.7 | **G** | BTTS über Event-Odds: Begrenzung je Lauf und Monatsreserve waren vorhanden und wirksam. | bestehende Tests | unverändert, profitiert von 3.4 |

### Priorität 4 – Datengrundlage

| # | Typ | Änderung |
|---|---|---|
| 4.1 | **E** | `GET /api/admin/coverage` und eine Admin-Karte „Datengrundlage je Wettbewerb“: Spielplan, Quoten (je Markt), Historie, Teamzuordnung (nicht verknüpft, ohne Historie, mögliche Duplikate), Modelle berechenbar, Validierung je Markt, Status READY / PARTIAL / NO FIXTURES / INSUFFICIENT DATA mit Erklärung. Konfigurierte Sport-Keys ohne Spiele erscheinen ebenfalls. |
| 4.2 | **G** | Champions League ohne Historie: Alle vier Modelle sind nicht verfügbar, es gibt keine Wahrscheinlichkeiten und keine Empfehlung. Nationale Ligamodelle werden **nicht** übertragen, da die Historie je Wettbewerb gilt. Neu ist eine verständliche Erklärung in der Übersicht und in der Datenqualität (Test mit EPL-Historie und UCL-Spiel desselben Teams). |

### Priorität 5 – Start, Frontend, Betrieb

| # | Typ | Befund / Änderung |
|---|---|---|
| 5.1 | **B** | Ungültige `DATA_MODE`-Werte (z. B. `production`, `Live `) liefen stillschweigend als Mock. Dasselbe galt für `STRATEGY`. Jetzt bricht der Start mit klarer Meldung ab (Exit 2). Fehlt `DATA_MODE`, startet der Mock mit Hinweis. |
| 5.2 | **V** | `.env` wurde von `npm start` gar nicht geladen, nur Docker (`env_file`) nutzte sie. Neu ist `src/env.ts`: lädt `./.env`, `../.env` oder `<Projekt>/.env` bzw. `ENV_FILE`. Echte Umgebungsvariablen haben Vorrang, leere Einträge gelten nicht als gesetzt. Protokolliert werden nur Dateiname und Anzahl, nie Werte. |
| 5.3 | **V** | `.env.example` setzte `DB_PATH=/data/…` (Docker-Pfad). Außerhalb von Docker scheitert damit ein Start ohne Root-Rechte. Die Zeile ist jetzt auskommentiert (Docker setzt den Pfad selbst). |
| 5.4 | **E** | Lockfiles `backend/package-lock.json` und `frontend/package-lock.json`. Installation per `npm ci`, auch im Dockerfile. TypeScript auf `~6.0.3` festgelegt, `.nvmrc` (22). |
| 5.5 | **G/E** | Frontend-Typprüfung (`tsc --noEmit`, `strict`) ergänzt und in `npm run build` eingebunden. Ergebnis: **0 Typfehler** im Original und in v0.4.0 (20 Dateien). Es gab keine tatsächlichen Typfehler zu beheben. Mit `noUnusedLocals` zeigen sich nur ungenutzte `React`-Default-Importe (Stil). |
| 5.6 | **E** | Start für Windows und Linux: `scripts/start.mjs` (Node, plattformunabhängig), `start.sh`, `start.ps1`, `npm run dev:mock`, `npm run start:live`. Siehe [START.md](START.md). |
| 5.7 | **V/E** | KI-Analyst: Die Modellkennung `claude-sonnet-5-5` stimmt mit der offiziellen Modellübersicht (Stand 10/2026) überein und ist per `ANTHROPIC_MODEL` steuerbar. Neu sind `ANTHROPIC_EFFORT` (Standard low), `ANTHROPIC_MAX_TOKENS` (Standard 4000) und `ANTHROPIC_SERVER_FALLBACK`. Der serverseitige Refusal-Fallback `fallbacks: "default"` wird nur bei unterstützten Modellen gesendet. **Befund:** Ablehnung (`refusal`), abgeschnittene (`max_tokens`) oder leere Antworten wurden bisher als leere KI-Antwort ausgegeben, und der Fallback war stumm. Jetzt gibt es einen klar gekennzeichneten lokalen Regelmodus mit Grund („LOKALER Regelmodus …“) in ES/DE/EN. |
| 5.8 | **E** | Wortlaut: Experimentelle Signale heißen „experimentell, kein nachgewiesener Vorteil“. Die Meta-Beschreibung sagte „datos verificados“ und lautet jetzt „cuotas validadas y modelos transparentes“. Die Performance-Seite zeigt Bereiche mit „nicht schlechter – kein Mehrwert-Nachweis“. |
| 5.9 | **G** | Oberfläche bei 375, 390, 430 und 1440 px (6 Seiten je Breite): kein horizontales Scrollen, keine JS-Fehler, Marke sichtbar, Spanisch als Standard. **80/80 PASS** (`docs/screenshots/v040/RESULTS.txt`). |
| 5.10 | **G** | Migration 008 ist rein ergänzend. Upgrade-Test mit einer **echten v0.3.4-Datenbank** (vom Original-Build erzeugt): Daten erhalten, eingefrorene Einträge unverändert, Neustart idempotent. Details in [TEST_REPORT_v0.4.0.md](TEST_REPORT_v0.4.0.md). |

## 2. Betroffene Dateien

**Backend – Code:** `src/engines/value.ts`, `src/engines/prediction/index.ts`, `src/engines/backtest.ts`, `src/engines/validation.ts`, `src/engines/recommendation.ts`, `src/engines/discovery.ts`, `src/engines/oddsApiStatus.ts`, `src/engines/analyst.ts`, `src/engines/coverage.ts` (neu), `src/providers/theOddsApi.ts`, `src/providers/types.ts`, `src/api/apiQueue.ts`, `src/scheduler.ts`, `src/server.ts`, `src/cli.ts`, `src/main.ts`, `src/config.ts`, `src/env.ts` (neu), `src/db/migrations/008_v040_pilot_consistency.sql` (neu).
**Backend – Tests:** neu `test/v040_p1_persistence.test.ts`, `v040_p2_backtest.test.ts`, `v040_p3_odds_api.test.ts`, `v040_p4_coverage.test.ts`, `v040_p5_ops.test.ts`. Angepasst (beabsichtigte Verhaltensänderung, jeweils kommentiert): `test/pipeline.test.ts` (1.3), `test/v030_api_pilot.test.ts` (3.4), `test/v033_odds_api.test.ts` (Meldungstext 3.4), `test/helpers.ts` (Parameter für die synthetische Liga).
**Frontend:** `src/coverage.tsx` (neu), `src/oddsapi.tsx`, `src/pages/admin.tsx`, `src/pages/performance.tsx`, `src/pages/edge.tsx`, `src/reasons.ts`, `src/i18n.ts`, `src/ui.tsx`, `index.html`, `tsconfig.json` (neu), `package.json`, `package-lock.json` (neu).
**Betrieb/Doku:** `package.json`, `.env.example`, `.nvmrc`, `Dockerfile`, `start.sh`, `start.ps1`, `scripts/start.mjs`, `scripts/e2e-viewports.mjs`, `start-codespaces.sh` (Versionstext), `START.md`, `CHANGES_v0.4.0.md`, `TEST_REPORT_v0.4.0.md`, `OPEN_BLOCKERS.md`, `CHANGELOG.md`, `THE_ODDS_API_INTEGRATION.md`, `README.md`, `docs/screenshots/v040/`, `docs/test-evidence/`.

Nicht verändert: Authentifizierung, CSRF, Rollen, Abos und Zahlungsprüfung, Marke und Assets, Mock-Provider, Matching und Linking, Highlightly-Adapter.

---

<!-- Datei: TEST_REPORT_v0.4.0.md -->
# CanchaIA v0.4.0 – Testbericht (tatsächliche Ergebnisse)

Umgebung: Linux-Container, Node.js **22.22.0**, npm 10.9.4, TypeScript 6.0.3, Chromium (Playwright). Datum: 26.10.2026.
Alle Zahlen stammen aus Läufen in dieser Umgebung. Rohausgaben liegen in `docs/test-evidence/` und `docs/screenshots/v040/RESULTS.txt`.

## 1. Zusammenfassung

| Prüfung | v0.3.4 (Ist) | v0.4.0 |
|---|---|---|
| Backend-Build (tsc) | ok | ok |
| Backend-Typprüfung (`npm run typecheck`) | – | ok |
| Frontend-Typprüfung (`tsc --noEmit`, strict) | nicht vorhanden | **0 Fehler** (im Original ebenfalls 0) |
| Frontend-Build | ok | ok (mit Typprüfung) |
| Backend-Tests | 139/139 | **169/169 bestanden**, 0 fehlgeschlagen, 0 übersprungen (≈ 52 s) |
| Neue Tests | – | 30 (P1 7, P2 9, P3 6, P4 2, P5 5, Pipeline 1) |
| Reproduktion auf v0.3.4 | – | 8 von 10 auf v0.3.4 übertragbaren Regressionstests **schlagen dort fehl** (`repro_v034.txt`). Die zwei übrigen sind Schutztests (identische Neuberechnung, eingefrorene Einträge), die bereits vorher bestanden. |
| UI 375/390/430/1440 px | – | **80/80 PASS** |
| Neuinstallation aus Lockfiles (`npm ci`) + Start | – | ok |
| Neustart mit bestehender DB | – | ok (kein doppeltes Admin-Konto, keine Migration erneut) |
| Upgrade echte v0.3.4-DB → v0.4.0 | – | ok, Daten erhalten |
| Echter Netzwerktest The Odds API | – | **nur** kostenloser `/v4/sports` mit absichtlich ungültigem Schlüssel → HTTP 401 korrekt verarbeitet |

## 2. Reproduktion der Befunde auf dem unveränderten v0.3.4-Code

`docs/test-evidence/repro_v034.txt` (Auszug):

```
not ok  P1: geändertes Modellgewicht → gespeichert 0.38292257083303016, berechnet 0.3828657913847876
not ok  P1: geänderte Strategie → prob_low 0.34841248981218814 vs 0.32615348755374507
not ok  P1: geänderte Referenzquote … → gespeichert 0.3830020620605699, berechnet 0.38398444305264995
not ok  P1: korrigiertes historisches Ergebnis → Prognose muss die Korrektur berücksichtigen
not ok  P1: korrigierte xG-Statistik → neuer Fit
not ok  P3: Cache-Schlüssel mit wechselnden Zeitfenstern → 2 !== 1 Abrufe
not ok  P3: lastEvents → begonnenes Spiel übernommen
not ok  P3: Ergebnisse gebündelt → /scores für soccer_epl UND soccer_uefa_champs_league (2 !== 1)
```

Backtest v0.3.4 (`p2_baseline.txt`): 13 Spiele mit 2 simulierten Wetten. Die Backtest-Unsicherheit ist identisch mit `combine()` ohne λ (0,0424).
Gleiche synthetische Liga (20 Teams × 5 Saisons), Validierung:

| | v0.3.4 | v0.4.0 |
|---|---|---|
| Gesamtstatus | FAILED (alles blockiert) | PARTIAL |
| 1X2 | „nicht signifikant besser als Basisrate“ (KI-Obergrenze +0,0002) | VALIDATED, Markt: NOT_WORSE (KI-Obergrenze −0,0001; knapp) |
| OU | ECE 0,056 → FAILED | FAILED (ECE 0,056) |
| BTTS | keine Quoten → blockiert alles | UNVALIDATED, NOT_TESTABLE (blockiert nur BTTS) |
| simulierte Wetten | 645 | 373 (live-gleiche Auswahl; 184 korrelierte entfernt, 78 AVOID) |

Hinweis: Die synthetische Liga prüft nur die Logik. Der 1X2-Wert liegt knapp an der Signifikanzgrenze. Der Unterschied zwischen alt und neu stammt aus dem korrigierten Informationsstand und den Bootstrap-Seeds. Er ist **kein** Qualitätsnachweis.

## 3. Neue Tests (Auszug der Prüfziele)

- **Signaländerungen:** geänderte Referenzquote bei gleicher bester Quote, geändertes Modellgewicht, geänderte Strategie, identische Neuberechnung (keine neue Version), eingefrorene Einträge unverändert.
- **Prognose-Cache:** korrigiertes Ergebnis und korrigierte xG führen zu neuem Fit. Gespeicherte und zurückgegebene Prognose sind identisch.
- **Backtest/Live-Konsistenz:** λ und Stichprobengröße wie live, Informationsstand mit laufenden Spielen, dichter Spielplan, höchstens 1 je Spiel und 5 je Fenster, gleiche Entscheidungsregel (Datenqualität, AVOID, Strategie, STRONG_VALUE nur mit Markt-Mehrwert).
- **Marktbezogene Validierung:** BTTS ohne Quoten blockiert 1X2 nicht. „Nicht schlechter“ ist kein Mehrwert. Validierte Version gilt nur für geprüfte Wettbewerbe und Märkte. Alte globale Version wird ignoriert. Der Scheduler nutzt den Validierungsweg mit Datenqualitätsprüfung.
- **Kostenlose Discovery:** Der Job ruft nur `/sports` und `/events` auf, 0 Credits, auch ohne Verbindungstest.
- **Budgetgrenzen:** Vorabprüfung vor dem ersten bezahlten Abruf, überzählige Wettbewerbe werden mit Grund übersprungen, ohne Budget gibt es keinen Abruf. Anbieter-Restcredits stoppen vor dem Senden (bestehende Tests angepasst).
- **Cache-Schlüssel, lastEvents, gebündelte Ergebnisse, getrennte Admin-Nachweise** (Verbindungstest ≠ Quoten ≠ Prognosen).
- **Datengrundlage:** EPL berechenbar, UCL INSUFFICIENT DATA mit Erklärung, keine Wahrscheinlichkeiten, keine Empfehlung, keine Übertragung des EPL-Modells.
- **Betrieb:** ungültiges DATA_MODE/STRATEGY bricht ab, `.env`-Vorrang, KI-Analyst (Modell konfigurierbar, effort/Fallback nur für unterstützte Modelle, 404/refusal/max_tokens → gekennzeichneter Regelmodus), Migration 008 und Neustart.

## 4. Oberfläche

`node scripts/e2e-viewports.mjs` gegen die echte App (Mock-Modus), Seiten Inicio, Partidos, Analista IA, Rendimiento, Ajustes, Admin bei 375 × 812, 390 × 844, 430 × 932 (mobil, Touch) und 1440 × 900:
kein horizontales Scrollen, Marke sichtbar, Spanisch als Standard, keine JS-Fehler, keine Behauptung eines verifizierten Vorteils → **80 PASS, 0 FAIL**. Screenshots: `docs/screenshots/v040/`.

## 5. Installation, Start, Upgrade

1. **Neuinstallation:** Saubere Kopie ohne `node_modules` und `dist`. `node scripts/start.mjs mock` legt `.env` aus `.env.example` an, führt `npm ci` (backend, frontend) aus, baut mit Typprüfung und startet. `/api/health` → `{"ok":true}`. Die `.env` wurde geladen (nur Dateiname und Anzahl protokolliert).
2. **Neustart** (`--no-install --no-build`) mit bestehender DB: ok, Admin nicht doppelt, 8 Migrationen, keine erneut angewendet.
3. **Upgrade mit echter v0.3.4-DB:** Die DB wurde mit dem **Original-Build v0.3.4** erzeugt (`cli sync`, Mock). Danach v0.4.0 `cli sync` auf derselben Datei:

```
v0.3.4:              migr 7, events 1008, snaps 264, preds 24, sigs 168, recs 3, frozen 3, users 2
v0.4.0 nach Sync:    migr 8, events 1008, snaps 264, preds 48, sigs 336, recs 5, frozen 3, users 2
eingefrorene Einträge vorher 3, unverändert 3
v0.4.0 zweiter Lauf: migr 8, … frozen 3 (Neustart idempotent)
```

4. **Windows/PowerShell:** `start.ps1` ist geschrieben, konnte hier aber **nicht ausgeführt** werden (kein PowerShell im Container). Die Logik liegt vollständig in `scripts/start.mjs`, das unter Linux getestet wurde.

## 6. Live-Tests

| Ziel | Voraussetzung | Ergebnis |
|---|---|---|
| The Odds API Verbindung (kostenlos) | Netzwerk ja, **Schlüssel nein** | Echter Abruf `GET /v4/sports` mit absichtlich ungültigem Schlüssel: **HTTP 401**, Status DISCONNECTED, kostenpflichtige Abrufe gesperrt, 0 Credits, Schlüssel weder in Ausgabe noch in DB (`live_401_check.txt`). |
| Quoten `/odds`, Event-Odds BTTS, `/scores`, Credit-Header | gültiger `THE_ODDS_API_KEY` | **NICHT durchgeführt – Schlüssel fehlt.** Nur mit nachgebauten Antworten getestet. |
| KI-Analyst (Anthropic) | `ANTHROPIC_API_KEY` | **NICHT durchgeführt – Schlüssel fehlt.** Nur mit eingespieltem Fetcher getestet. |
| Validierung mit echten Daten | CSV-Historie (football-data.co.uk) | **NICHT durchgeführt – keine echten Daten im Paket.** Alle Bereiche bleiben UNVALIDATED. |

Es wurde **nichts Simuliertes als live bestätigt** ausgegeben. Kostenpflichtige Abrufe oder Schleifen wurden nicht gestartet.

---

<!-- Datei: OPEN_BLOCKERS.md -->
# CanchaIA v0.4.0 – Offene Blocker und Grenzen

Stand: 26.10.2026. Diese Punkte verhindern die Bezeichnung „produktionsreif“ oder „profitabel“.

## Blocker für einen aussagekräftigen Live-Pilot

1. **Kein echter Quoten-Live-Test.** In der Arbeitsumgebung war kein `THE_ODDS_API_KEY` verfügbar. Live geprüft ist nur der kostenlose `/v4/sports`-Abruf mit ungültigem Schlüssel (HTTP 401-Pfad). Nicht live geprüft sind `/events` mit gültigem Schlüssel, `/odds`, Event-Odds (BTTS), `/scores` und die echten Werte von `x-requests-*`.
   → Vorgehen: siehe START.md, Abschnitt 3 (erst Verbindungstest, dann kontrollierter Sync mit wenigen Spielen, Scheduler aus).
2. **Keine echte historische Validierung.** Im Paket sind keine echten CSV-Daten enthalten. Alle Bereiche (Wettbewerb × Markt) sind **UNVALIDATED**. Signale sind experimentell, STRONG_VALUE ist gesperrt. Es gibt **keinen** Nachweis eines Vorteils gegenüber dem Markt und keinen Profitabilitätsnachweis.
   → CSV von football-data.co.uk importieren (mindestens 3–4 Saisons je Liga) und `npm --prefix backend run validate` ausführen. Für einen Bereich sind mindestens 300 Holdout-Spiele **und** 300 Marktquoten nötig.
3. **Geschätzte Quotenzeitpunkte in CSV-Daten** (Anstoß − 24 h). Der Marktvergleich im Backtest beruht damit auf geschätzter Verfügbarkeit, nicht auf belegter. Eine belastbare Aussage braucht zeitgestempelte Quoten, etwa eigene Live-Snapshots über mehrere Monate oder kostenpflichtige historische Odds.
4. **Champions League:** keine geeignete Historie. Sie bleibt dauerhaft INSUFFICIENT DATA, bis eine geprüfte Datenquelle und ein eigenes, validiertes Modell vorliegen.
5. **Rechtliches** (unverändert aus früheren Versionen): Nutzungsrechte football-data.co.uk für ein kostenpflichtiges Produkt, Weitergabe der The-Odds-API-Quoten an zahlende Endkunden, Markenregistrierung „CanchaIA“, uPay-Händlerfreigabe. Alle **nicht geklärt**.

## Nicht in dieser Umgebung geprüft

6. **Windows/PowerShell:** `start.ps1` wurde nicht ausgeführt (kein PowerShell im Container). Der gemeinsame Launcher `scripts/start.mjs` ist unter Linux getestet.
7. **KI-Analyst live:** kein `ANTHROPIC_API_KEY`. Modellkennung, `output_config.effort` und `fallbacks: "default"` entsprechen der offiziellen Doku (Stand 10/2026), wurden aber nur mit eingespielten Antworten getestet. Bei einem älteren Modell `ANTHROPIC_EFFORT=none` setzen. Jeder Fehler führt zum gekennzeichneten lokalen Regelmodus.
8. **iPhone-Codespaces-Start** (`start-codespaces.sh`): nicht erneut auf einem Gerät getestet. Nur der Versionstext wurde angepasst.

## Bekannte fachliche Grenzen (dokumentiert, kein Fehler)

9. **Backtest-Auswahlfenster** = Kalendertag des Entscheidungszeitpunkts. Live wird stündlich neu bewertet; das Fenster ist eine dokumentierte Näherung an „höchstens 5 aktive Empfehlungen“.
10. Im Backtest gibt es keine historischen Aufstellungen und keine Verletzungsdaten. Live gibt es ebenfalls keine Verletzungs- oder Sperrdatenquelle.
11. **Prognose-Hash bei Rückkehr zu früheren Eingaben** innerhalb derselben Stunde (Korrektur und danach Rückkorrektur): Die ältere Prognosezeile wird wiederverwendet, eine darauf beruhende Empfehlung gilt bis zum nächsten Stundenwechsel als „ersetzt“. Das ist konservativ (eher keine als eine falsche Empfehlung), aber kosmetisch unschön.
12. BTTS ohne Quoten erscheint im Signalstatus weiterhin als `MARKET_SUSPENDED` (bestehende Benennung) mit dem Grund „keine Quoten für diesen Markt“.
13. Einige Backend-Begründungen (z. B. Nachweis-Hinweise in der Admin-Karte) erscheinen auf Deutsch, wenn keine Übersetzungsregel existiert. Das ist gewollt, lieber Deutsch als eine falsche Übersetzung.

---

<!-- Datei: START.md -->
# CanchaIA v0.4.0 – Startanleitung (Windows/PowerShell und Linux/macOS)

Voraussetzung: **Node.js ≥ 22.13** (empfohlen Node 22 LTS, siehe `.nvmrc`). Es gibt keine weiteren Laufzeitabhängigkeiten, SQLite ist in Node enthalten.

## 1. Schnellstart im Mock-Modus (fiktive Daten, keine externen Abrufe)

Linux/macOS:
```bash
cd Aposta_Edge_AI
./start.sh mock
```

Windows (PowerShell):
```powershell
cd Aposta_Edge_AI
.\start.ps1 mock
# Falls Skripte gesperrt sind:
powershell -ExecutionPolicy Bypass -File .\start.ps1 mock
```

Gleichwertig auf allen Systemen: `node scripts/start.mjs mock` oder `npm run dev:mock`.

Der Launcher geht so vor:
1. Er prüft die Node-Version.
2. Er legt `.env` aus `.env.example` an, **nur falls** keine existiert.
3. Er installiert Abhängigkeiten exakt aus den Lockfiles (`npm ci`), wenn `node_modules` fehlt.
4. Er baut Frontend (mit TypeScript-Prüfung) und Backend.
5. Er startet auf http://localhost:8080.

Vor dem ersten Start in `.env` eintragen: `ADMIN_EMAIL` und `ADMIN_PASSWORD` (mindestens 12 Zeichen, Buchstaben und Ziffern). Ohne diese Angaben ist keine Anmeldung möglich. Nach dem ersten Start `ADMIN_PASSWORD` wieder entfernen.

Optionen: `--no-install` (keine Installation), `--no-build` (vorhandenen Build nutzen).

## 2. Wie die Konfiguration geladen wird

- Das Backend lädt automatisch die erste vorhandene Datei aus `./.env`, `../.env` und `<Projektordner>/.env`. Alternativ `ENV_FILE=<pfad>`; `ENV_FILE=none` lädt keine Datei.
- **Echte Umgebungsvariablen haben Vorrang** (Hosting-, Codespaces- und Docker-Secrets). Leere Einträge (`KEY=`) gelten als nicht gesetzt.
- Beim Start werden nur Dateiname und Anzahl der übernommenen Variablen protokolliert, **nie Werte**.
- `DATA_MODE` darf nur `mock` oder `live` sein, `STRATEGY` nur `CONSERVATIVE`, `BALANCED` oder `AGGRESSIVE`. Andere Werte brechen den Start mit Meldung ab.
- Secrets wie `THE_ODDS_API_KEY` und `ANTHROPIC_API_KEY` gehören in die Secret-Verwaltung der Umgebung oder in eine lokale `.env` mit Rechten 600. Nie in Git, nie ins Frontend.

## 3. Kontrollierter Live-Pilot (The Odds API)

1. Neuen Schlüssel als Secret `THE_ODDS_API_KEY` setzen. Dazu in `.env`: `DATA_MODE=live`, Budgets (`THE_ODDS_API_MONTHLY_BUDGET`, `THE_ODDS_API_DAILY_BUDGET`) und `THE_ODDS_API_SPORT_KEYS` (z. B. `soccer_epl`).
2. Für den ersten Lauf **`SCHEDULER_ENABLED=false`** setzen.
3. Starten: `./start.sh live` bzw. `.\start.ps1 live`.
4. In Admin → THE ODDS API „Verbindung testen (kostenlos)“ ausführen, oder `npm --prefix backend run odds:check`. Das kostet 0 Credits. Ein bestandener Test belegt **nur** die Verbindung, keine Quoten.
5. Admin → „Kontrollierter Sync“ mit wenigen Spielen. Vorher erscheint ein Kostenvoranschlag, und Budgets und Restcredits werden geprüft.
6. Unter Admin → Nachweise prüfen, ob „Quoten (kostenpflichtig)“ und „Prognosen mit echten Quoten“ als VERIFIZIERT erscheinen.
7. Erst dann den Scheduler aktivieren. Spielsuche (kostenlos) und Quotenabruf (kostenpflichtig) laufen getrennt: `THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES` (Standard 30) und `THE_ODDS_API_ODDS_INTERVAL_MINUTES` (Standard 60).

Für Prognosen braucht jede Liga eine eigene Historie: CSV von football-data.co.uk importieren (`npm --prefix backend run import:csv -- E0.csv …`), danach `npm --prefix backend run validate`. Wettbewerbe ohne Historie (z. B. Champions League) bleiben **INSUFFICIENT DATA**. Admin → „Datengrundlage je Wettbewerb“ zeigt den Stand.

## 4. Docker

```bash
cp .env.example .env   # Werte setzen; DB_PATH NICHT setzen (Image nutzt /data)
docker compose up -d --build
```
Das Image installiert aus den Lockfiles (`npm ci`).

## 5. Prüfen

```bash
npm run install:all     # npm ci in backend und frontend
npm run check           # Typprüfung Frontend + Backend, danach alle Backend-Tests
```

---

## Code-Diff v0.3.4 → v0.4.0

```diff
diff --git a/.env.example b/.env.example
index f8f8373..9e08a6f 100644
--- a/.env.example
+++ b/.env.example
@@ -1,12 +1,21 @@
 # ---------------------------------------------------------------------------
-# Aposta Edge AI – Konfiguration. Kopieren nach .env und Werte setzen.
+# CanchaIA v0.4.0 – Konfiguration. Kopieren nach .env (im Projektordner) und Werte setzen.
 # Niemals echte Schlüssel in Git einchecken.
+#
+# So wird .env geladen (v0.4.0, eindeutig):
+#  - Das Backend lädt beim Start automatisch die erste vorhandene Datei: ./.env, ../.env oder <Projektordner>/.env.
+#    Alternativ ENV_FILE=<pfad> setzen; ENV_FILE=none lädt keine Datei.
+#  - Echte Umgebungsvariablen (Hosting-Secrets, Codespaces-Secrets, Docker) haben IMMER Vorrang vor .env.
+#  - Leere Einträge (KEY=) gelten als NICHT gesetzt.
+#  - Beim Start wird nur der Dateiname und die Anzahl übernommener Variablen protokolliert, nie ein Wert.
+# Ungültige Werte für DATA_MODE oder STRATEGY brechen den Start mit einer klaren Meldung ab (kein stiller Ersatz).
 # ---------------------------------------------------------------------------
 
-# mock = geschützter Entwicklungsmodus mit fiktiven Daten | live = echte Provider
+# mock = geschützter Entwicklungsmodus mit fiktiven Daten | live = echte Provider. Nur diese zwei Werte sind gültig.
 DATA_MODE=mock
 PORT=8080
-DB_PATH=/data/aposta-edge.sqlite
+# SQLite-Datei. Leer/auskommentiert = backend/data/aposta-edge.sqlite. Docker setzt /data/aposta-edge.sqlite selbst.
+# DB_PATH=
 APP_TIMEZONE=America/Asuncion
 
 # --- Zugang (v0.2.0) -------------------------------------------------------
@@ -16,7 +25,8 @@ ADMIN_EMAIL=
 ADMIN_PASSWORD=
 # Offene Selbstregistrierung (Rolle "user"). Standard: aus – Konten legt ein Admin an.
 ALLOW_REGISTRATION=false
-# Session-Cookies nur über HTTPS (Standard true). Nur für lokale Tests über http://localhost auf false setzen.
+# Session-Cookies nur über HTTPS (Standard true). http://localhost gilt in Chrome/Firefox als sicher; nur falls die Anmeldung
+# lokal über http scheitert (z. B. Safari oder Zugriff über eine LAN-IP), für lokale Tests auf false setzen.
 COOKIE_SECURE=true
 # X-Forwarded-For nur auswerten, wenn ein vertrauenswürdiger Reverse-Proxy davor steht
 TRUST_PROXY=false
@@ -57,8 +67,15 @@ THE_ODDS_API_INCLUDE_BTTS=false
 THE_ODDS_API_BTTS_MAX_EVENTS=5
 # BTTS nur, solange mindestens dieser Anteil (%) des Monatsbudgets frei ist
 THE_ODDS_API_BTTS_RESERVE_PCT=25
-# Ergebnisse über /scores?daysFrom=3 (2 Credits je Wettbewerb und Abruf, Cache 30 min)
+# Ergebnisse über /scores?daysFrom=3: v0.4.0 gebündelt – höchstens 1 Abruf (2 Credits) je Wettbewerb mit offenen Spielen der letzten 3 Tage
 THE_ODDS_API_RESULTS=true
+# v0.4.0: getrennte Intervalle
+# Kostenlose Spielsuche (GET /v4/sports/{sport}/events, 0 Credits) in Minuten, mindestens 10
+THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES=30
+# Kostenpflichtige Quotenabrufe + Analyse in Minuten, mindestens 15 (ersetzt SYNC_INTERVAL_MINUTES, das weiter gilt, wenn dieser Wert fehlt)
+# Kosten je Lauf ≈ Wettbewerbe × 2 Märkte (h2h, totals) × Regionen. Vor jedem Lauf werden Tages-, Monatsbudget und
+# Anbieter-Restcredits geprüft; Wettbewerbe, die nicht mehr ins Budget passen, werden mit Grund übersprungen.
+THE_ODDS_API_ODDS_INTERVAL_MINUTES=60
 
 # --- Pilotbetrieb (v0.3.0) -----------------------------------------------------
 # Nur ausgewählte Wettbewerbe und begrenzte Spiele je Lauf. Keys werden gegen /v4/sports geprüft.
@@ -66,9 +83,17 @@ PILOT_MODE=false
 PILOT_SPORT_KEYS=soccer_epl,soccer_spain_la_liga,soccer_uefa_champs_league
 PILOT_MAX_EVENTS=30
 
-# --- Edge Analyst (optional; ohne Schlüssel läuft der Regelmodus) -------------
+# --- KI-Analyst (optional; ohne Schlüssel läuft der klar gekennzeichnete lokale Regelmodus) -------------
 ANTHROPIC_API_KEY=
+# Modell-ID laut offizieller Anthropic-Modellübersicht (Stand 2026-10: claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5)
 ANTHROPIC_MODEL=claude-sonnet-5-5
+# output_config.effort: low | medium | high | xhigh | max. "none" = nicht senden (für ältere Modelle ohne effort)
+ANTHROPIC_EFFORT=low
+# Höchstzahl Ausgabetokens je Antwort (512–32000)
+ANTHROPIC_MAX_TOKENS=4000
+# Serverseitiger Fallback bei Ablehnung (beta server-side-fallback-2026-07-01, fallbacks: "default").
+# Wird nur für Modelle gesendet, die ihn unterstützen (claude-sonnet-5-5, claude-opus-5-5, claude-opus-5, claude-fable-5-1).
+ANTHROPIC_SERVER_FALLBACK=true
 
 # --- Benachrichtigungen (optional) -------------------------------------------
 TELEGRAM_BOT_TOKEN=
@@ -78,11 +103,15 @@ ALERT_WEBHOOK_URL=
 # --- Analyse ------------------------------------------------------------------
 ANALYSIS_HORIZON_HOURS=48
 MIN_EV=0.05
+# Höchstens 5 Empfehlungen, höchstens eine je Spiel (fest). Kleinere Werte sind möglich.
 MAX_RECOMMENDATIONS=5
+# CONSERVATIVE | BALANCED | AGGRESSIVE (andere Werte brechen den Start ab)
 STRATEGY=BALANCED
 # Basis-Altersgrenze für Quoten; näher am Anstoß gelten strengere Grenzen (60/30/10 min)
 ODDS_MAX_AGE_MINUTES=90
-SYNC_INTERVAL_MINUTES=60
+# Altname für das Quotenintervall (siehe THE_ODDS_API_ODDS_INTERVAL_MINUTES)
+# SYNC_INTERVAL_MINUTES=60
+# false = keine automatischen Läufe (weder Spielsuche noch Quoten). Für erste Live-Tests empfohlen.
 SCHEDULER_ENABLED=true
 LOG_LEVEL=info
 
diff --git a/.nvmrc b/.nvmrc
new file mode 100644
index 0000000..2bd5a0a
--- /dev/null
+++ b/.nvmrc
@@ -0,0 +1 @@
+22
diff --git a/Dockerfile b/Dockerfile
index 3e3227e..c735167 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -2,9 +2,9 @@
 FROM node:22-alpine AS build
 WORKDIR /app
 COPY frontend/package*.json frontend/
-RUN npm --prefix frontend install --no-audit --no-fund
+RUN npm --prefix frontend ci --no-audit --no-fund
 COPY backend/package*.json backend/
-RUN npm --prefix backend install --no-audit --no-fund
+RUN npm --prefix backend ci --no-audit --no-fund
 COPY frontend frontend
 COPY backend backend
 RUN npm --prefix frontend run build && npm --prefix backend run build
diff --git a/backend/package.json b/backend/package.json
index f4e56ae..9e64f07 100644
--- a/backend/package.json
+++ b/backend/package.json
@@ -1,6 +1,6 @@
 {
   "name": "aposta-edge-ai-backend",
-  "version": "0.3.4",
+  "version": "0.4.0",
   "private": true,
   "type": "module",
   "description": "Aposta Edge AI – Discovery, Prognose, Value- und Backtesting-Backend",
@@ -20,10 +20,11 @@
     "odds:check": "node --disable-warning=ExperimentalWarning dist/src/cli.js odds-check",
     "user:create": "node --disable-warning=ExperimentalWarning dist/src/cli.js user-create",
     "user:password": "node --disable-warning=ExperimentalWarning dist/src/cli.js user-password",
-    "test": "npm run build && node --disable-warning=ExperimentalWarning --test \"dist/test/**/*.test.js\""
+    "test": "npm run build && node --disable-warning=ExperimentalWarning --test \"dist/test/**/*.test.js\"",
+    "typecheck": "tsc -p tsconfig.json --noEmit"
   },
   "devDependencies": {
     "@types/node": "^22.13.0",
-    "typescript": "^5.6.0 || ^6.0.0"
+    "typescript": "~6.0.3"
   }
 }
diff --git a/backend/src/api/apiQueue.ts b/backend/src/api/apiQueue.ts
index a3f7b11..7befb69 100644
--- a/backend/src/api/apiQueue.ts
+++ b/backend/src/api/apiQueue.ts
@@ -82,6 +82,8 @@ export class ApiQueue {
   constructor(private db: Db, private fetcher: Fetcher = defaultFetcher, private now: () => Date = () => new Date(), private backoffScale = 1) {}
 
   register(b: ProviderBudget): void { this.budgets.set(b.provider, b); }
+  /** Uhr der Queue (in Tests simuliert); Provider nutzen sie, wenn kein Lauf-Zeitpunkt gesetzt ist. */
+  currentTime(): Date { return this.now(); }
 
   /** Verbrauchte Credits heute (ohne Cache-Treffer). */
   usedToday(provider: string): number {
diff --git a/backend/src/cli.ts b/backend/src/cli.ts
index a6a63c3..017cfcf 100644
--- a/backend/src/cli.ts
+++ b/backend/src/cli.ts
@@ -3,10 +3,11 @@
  *               | odds-check [--paid-test]   (v0.3.3, The Odds API: kostenloser Verbindungstest, optional EIN kontrollierter Quotenabruf)
  * Passwort für user-create über die Umgebungsvariable NEW_USER_PASSWORD (nie als Argument, damit es nicht in der Shell-Historie landet).
  */
+import { envLoad } from './env.js';
 import fs from 'node:fs';
-import { loadConfig } from './config.js';
+import { loadConfig, ConfigError } from './config.js';
 import { buildApp, seedMock } from './app.js';
-import { BacktestingEngine } from './engines/backtest.js';
+import { validationSettings } from './scheduler.js';
 import { importFootballDataCsv } from './providers/footballDataCsv.js';
 import { AuthService } from './auth.js';
 import path from 'node:path';
@@ -16,7 +17,10 @@ import { oddsApiStatus, testOddsApiConnection } from './engines/oddsApiStatus.js
 import { controlledSync } from './engines/diagnostic.js';
 
 const [cmd, ...args] = process.argv.slice(2);
-const cfg = loadConfig();
+let cfg: ReturnType<typeof loadConfig>;
+try { cfg = loadConfig(); }
+catch (e) { if (e instanceof ConfigError) { console.error(`Konfigurationsfehler: ${e.message}`); process.exit(2); } throw e; }
+if (envLoad.error) console.error(envLoad.error);
 const app = buildApp(cfg);
 
 switch (cmd) {
@@ -31,8 +35,11 @@ switch (cmd) {
   }
   case 'backtest': {
     if (cfg.dataMode === 'mock') await seedMock(app);
-    const r = new BacktestingEngine(app.db).run({ includeMock: cfg.dataMode === 'mock' });
-    console.log(JSON.stringify({ runId: r.runId, ...r.metrics, holdoutEnsemble: Object.fromEntries(Object.entries(r.metrics.holdoutEnsemble).map(([k, x]) => [k, { ...x, calibration: undefined }])) }, null, 2));
+    // v0.4.0: immer über den Validierungsablauf (Datenqualität → Backtest), damit kein Weg die Prüfung umgeht
+    const rep = runValidation(app.db, { includeMock: cfg.dataMode === 'mock', ...validationSettings(app) });
+    const m = rep.metrics;
+    console.log(JSON.stringify({ validationId: rep.id, status: rep.status, backtestRunId: rep.backtestRunId, scopes: m?.scopes, betting: m?.betting, reasons: rep.reasons,
+      holdoutEnsemble: m ? Object.fromEntries(Object.entries(m.holdoutEnsemble).map(([k, x]) => [k, { ...x, calibration: undefined }])) : null }, null, 2));
     break;
   }
   case 'import-csv': {
@@ -47,7 +54,7 @@ switch (cmd) {
   case 'validate': {
     // Validierungsablauf: Datenqualität → Backtest → Bericht (Markdown + JSON) in data/validation/
     if (cfg.dataMode === 'mock') await seedMock(app);
-    const rep = runValidation(app.db, { includeMock: cfg.dataMode === 'mock' });
+    const rep = runValidation(app.db, { includeMock: cfg.dataMode === 'mock', ...validationSettings(app) });
     const dir = args[0] ?? path.resolve('data', 'validation');
     fs.mkdirSync(dir, { recursive: true });
     const base = path.join(dir, `validation-${rep.id}`);
diff --git a/backend/src/config.ts b/backend/src/config.ts
index f18e628..9396cd3 100644
--- a/backend/src/config.ts
+++ b/backend/src/config.ts
@@ -56,6 +56,10 @@ export interface Config {
     bttsReservePct: number;
     /** Ergebnisse über /scores?daysFrom=3 (2 Credits je Wettbewerb) für die Abrechnung. */
     resultsEnabled: boolean;
+    /** v0.4.0: Intervall der KOSTENLOSEN Spielsuche (/events) in Minuten (mind. 10). */
+    discoveryIntervalMinutes: number;
+    /** v0.4.0: Intervall der KOSTENPFLICHTIGEN Quotenabrufe + Analyse in Minuten (mind. 15). */
+    oddsIntervalMinutes: number;
   };
   /** Kontrollierter Pilotbetrieb: nur ausgewählte Wettbewerbe und begrenzte Spiele je Lauf. */
   pilot: {
@@ -63,7 +67,8 @@ export interface Config {
     sportKeys: string[];
     maxEventsPerRun: number;
   };
-  anthropic: { apiKey: string | null; model: string };
+  /** Optionaler KI-Analyst. Modell, Aufwand und Ausgabelänge per Umgebung steuerbar; ohne Schlüssel lokaler Regelmodus. */
+  anthropic: { apiKey: string | null; model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null; maxTokens: number; serverFallback: boolean };
   alerts: {
     telegramBotToken: string | null;
     telegramChatId: string | null;
@@ -90,10 +95,17 @@ export interface Config {
   };
 }
 
+/** Ungültige Konfiguration: Start wird mit klarer Meldung abgebrochen (keine stille Ersatzannahme). */
+export class ConfigError extends Error {}
+
 export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
-  const dataMode = (env.DATA_MODE === 'live' ? 'live' : 'mock') as DataMode;
-  const strategy = (['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].includes(String(env.STRATEGY))
-    ? env.STRATEGY : 'BALANCED') as Strategy;
+  // v0.4.0: ungültige Werte werden NICHT mehr stillschweigend als Mock bzw. BALANCED übernommen
+  const dm = (env.DATA_MODE ?? '').trim();
+  if (dm && dm !== 'mock' && dm !== 'live') throw new ConfigError(`DATA_MODE="${dm.slice(0, 20)}" ist ungültig: erlaubt sind "mock" oder "live".`);
+  const dataMode = (dm === 'live' ? 'live' : 'mock') as DataMode;
+  const st = (env.STRATEGY ?? '').trim().toUpperCase();
+  if (st && !['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].includes(st)) throw new ConfigError(`STRATEGY="${st.slice(0, 20)}" ist ungültig: erlaubt sind CONSERVATIVE, BALANCED, AGGRESSIVE.`);
+  const strategy = (st || 'BALANCED') as Strategy;
   return {
     port: num(env.PORT, 8080),
     host: env.HOST || '0.0.0.0',
@@ -127,6 +139,8 @@ export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
       bttsMaxEventsPerRun: Math.max(0, Math.min(50, num(env.THE_ODDS_API_BTTS_MAX_EVENTS, 5))),
       bttsReservePct: Math.max(0, Math.min(90, num(env.THE_ODDS_API_BTTS_RESERVE_PCT, 25))),
       resultsEnabled: bool(env.THE_ODDS_API_RESULTS, true),
+      discoveryIntervalMinutes: Math.max(10, num(env.THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES, 30)),
+      oddsIntervalMinutes: Math.max(15, num(env.THE_ODDS_API_ODDS_INTERVAL_MINUTES, num(env.SYNC_INTERVAL_MINUTES, 60))),
     },
     pilot: {
       enabled: bool(env.PILOT_MODE, false),
@@ -135,7 +149,12 @@ export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
     },
     anthropic: {
       apiKey: env.ANTHROPIC_API_KEY || null,
+      // Modell-ID laut offizieller Modellübersicht (Stand 2026-10); per ANTHROPIC_MODEL änderbar
       model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
+      // output_config.effort; leer/"none" = nicht senden (für ältere Modelle ohne effort-Unterstützung)
+      effort: (() => { const e = (env.ANTHROPIC_EFFORT ?? 'low').trim().toLowerCase(); return (['low', 'medium', 'high', 'xhigh', 'max'] as const).find(x => x === e) ?? null; })(),
+      maxTokens: Math.max(512, Math.min(32000, num(env.ANTHROPIC_MAX_TOKENS, 4000))),
+      serverFallback: bool(env.ANTHROPIC_SERVER_FALLBACK, true),
     },
     alerts: {
       telegramBotToken: env.TELEGRAM_BOT_TOKEN || null,
@@ -148,7 +167,8 @@ export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
       maxRecommendations: Math.min(5, Math.max(1, num(env.MAX_RECOMMENDATIONS, 5))),
       strategy,
       oddsMaxAgeMinutes: num(env.ODDS_MAX_AGE_MINUTES, 90),
-      syncIntervalMinutes: Math.max(15, num(env.SYNC_INTERVAL_MINUTES, 60)),
+      // Kostenpflichtiger Lauf (Quoten + Analyse); THE_ODDS_API_ODDS_INTERVAL_MINUTES hat Vorrang vor dem Altnamen SYNC_INTERVAL_MINUTES
+      syncIntervalMinutes: Math.max(15, num(env.THE_ODDS_API_ODDS_INTERVAL_MINUTES, num(env.SYNC_INTERVAL_MINUTES, 60))),
     },
     schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
     frontendDir: env.FRONTEND_DIR || path.resolve('..', 'frontend', 'dist'),
@@ -192,6 +212,7 @@ export function providerStates(c: Config): ProviderState[] {
 /** Prüft, ob die Konfiguration für den gewählten Modus vollständig ist. Gibt fehlende Punkte zurück. */
 export function configIssues(c: Config): string[] {
   const issues: string[] = [];
+  if (!process.env.DATA_MODE) issues.push('DATA_MODE nicht gesetzt: Mock-Modus mit fiktiven Daten. Für echte Daten DATA_MODE=live setzen.');
   if (process.env.ADMIN_TOKEN && !c.adminToken) issues.push('ADMIN_TOKEN ignoriert: mindestens 32 Zeichen erforderlich.');
   if (process.env.READ_TOKEN && !c.readToken) issues.push('READ_TOKEN ignoriert: mindestens 32 Zeichen und verschieden von ADMIN_TOKEN.');
   if (!c.cookieSecure && c.dataMode === 'live') issues.push('COOKIE_SECURE=false im Live-Modus: Session-Cookies ohne Secure-Flag. Nur hinter HTTPS betreiben.');
diff --git a/backend/src/db/migrations/008_v040_pilot_consistency.sql b/backend/src/db/migrations/008_v040_pilot_consistency.sql
new file mode 100644
index 0000000..89e7bb1
--- /dev/null
+++ b/backend/src/db/migrations/008_v040_pilot_consistency.sql
@@ -0,0 +1,29 @@
+-- v0.4.0 – Konsistenz für den kontrollierten Pilotbetrieb. Nur ergänzend: keine bestehenden Daten werden geändert oder gelöscht.
+
+-- Signatur aller Berechnungswerte eines Signals (Prognose, Quote, Marktreferenz, EV, Konfiguration).
+-- Alte Zeilen behalten NULL: beim nächsten Lauf entsteht genau eine neue Version mit Signatur.
+ALTER TABLE value_signals ADD COLUMN calc_signature TEXT;
+
+-- Validierungsstatus je Wettbewerb × Markt einer Modellversion (append-only, wie model_versions).
+-- Live gilt ein Markt eines Wettbewerbs nur dann als validiert, wenn hier ein VALIDATED-Eintrag existiert.
+CREATE TABLE IF NOT EXISTS model_scope_validations (
+  id INTEGER PRIMARY KEY,
+  model_version_id TEXT NOT NULL REFERENCES model_versions(id),
+  backtest_run_id INTEGER,
+  competition_id INTEGER NOT NULL REFERENCES competitions(id),
+  market_id TEXT NOT NULL,                 -- 1X2 | OU | BTTS
+  status TEXT NOT NULL,                    -- VALIDATED | UNVALIDATED | FAILED
+  market_evidence TEXT NOT NULL,           -- BETTER | NOT_WORSE | WORSE | NOT_TESTABLE
+  holdout_n INTEGER NOT NULL,
+  market_n INTEGER NOT NULL,
+  blend_weight REAL,
+  odds_times_estimated INTEGER NOT NULL DEFAULT 0,
+  reasons TEXT NOT NULL,
+  created_at TEXT NOT NULL,
+  UNIQUE (model_version_id, competition_id, market_id)
+);
+CREATE INDEX IF NOT EXISTS idx_scope_val ON model_scope_validations(competition_id, market_id, status);
+CREATE TRIGGER IF NOT EXISTS model_scope_validations_immutable BEFORE UPDATE ON model_scope_validations
+BEGIN SELECT RAISE(ABORT, 'model_scope_validations sind unveraenderlich'); END;
+CREATE TRIGGER IF NOT EXISTS model_scope_validations_no_delete BEFORE DELETE ON model_scope_validations
+BEGIN SELECT RAISE(ABORT, 'model_scope_validations sind unveraenderlich'); END;
diff --git a/backend/src/engines/analyst.ts b/backend/src/engines/analyst.ts
index d72ee0a..d2f1bde 100644
--- a/backend/src/engines/analyst.ts
+++ b/backend/src/engines/analyst.ts
@@ -8,6 +8,7 @@ import type { Config } from '../config.js';
 import { RecommendationEngine } from './recommendation.js';
 import { PerformanceRepository } from './performance.js';
 import { BacktestingEngine } from './backtest.js';
+import { redact } from '../util/log.js';
 import { OddsStore } from './odds.js';
 import { checkFreshness } from './freshness.js';
 import { json } from '../db/db.js';
@@ -15,7 +16,11 @@ import { nameSimilarity, nowIso } from '../util/core.js';
 import type { MarketId } from '../providers/types.js';
 
 type Lang = 'es' | 'de' | 'en';
-export interface AnalystAnswer { answer: string; mode: 'llm' | 'rules'; toolsUsed: string[]; data: unknown[] }
+/** mode 'rules' = lokaler Regelmodus ohne externes Sprachmodell; fallbackReason nennt den Grund (v0.4.0). */
+export interface AnalystAnswer { answer: string; mode: 'llm' | 'rules'; toolsUsed: string[]; data: unknown[]; model?: string; fallbackReason?: string }
+
+/** Modelle, für die der serverseitige Refusal-Fallback (beta server-side-fallback-2026-07-01, "default") verfügbar ist. */
+const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
 
 export class EdgeAnalyst {
   private now: Date = new Date();
@@ -95,11 +100,12 @@ export class EdgeAnalyst {
   // ---------------------------------------------------------------- Antwort
   async ask(question: string, lang: Lang = 'es', history: { role: 'user' | 'assistant'; content: string }[] = [], now: Date = new Date()): Promise<AnalystAnswer> {
     this.now = now;
+    let fallbackReason = 'kein KI-Schlüssel konfiguriert: lokaler Regelmodus';
     if (this.cfg.anthropic.apiKey) {
       try { return await this.askLlm(question, lang, history); }
-      catch { /* Fallback auf Regeln */ }
+      catch (e) { fallbackReason = `Sprachmodell nicht verfügbar (${redact((e as Error).message).slice(0, 160)}): lokaler Regelmodus`; }
     }
-    return this.askRules(question, lang);
+    return { ...this.askRules(question, lang), fallbackReason };
   }
 
   private toolSchemas() {
@@ -128,19 +134,27 @@ Regeln:
 - model_prob ist die unabhängige Modellwahrscheinlichkeit; decision_prob = model_weight · Modell + (1 − model_weight) · fairer Marktpreis. EV basiert auf decision_prob.`;
     const msgs: any[] = [...history.slice(-6).map(h => ({ role: h.role, content: h.content })), { role: 'user', content: question }];
     const used: string[] = [], data: unknown[] = [];
+    // Serverseitiger Refusal-Fallback nur für Modelle, die ihn unterstützen (abschaltbar über ANTHROPIC_SERVER_FALLBACK=false)
+    const fallback = this.cfg.anthropic.serverFallback && SERVER_FALLBACK_MODELS.has(this.cfg.anthropic.model);
     for (let round = 0; round < 6; round++) {
       const r = await this.fetcher('https://api.anthropic.com/v1/messages', {
         method: 'POST',
-        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.anthropic.apiKey!, 'anthropic-version': '2023-06-01' },
-        body: JSON.stringify({ model: this.cfg.anthropic.model, max_tokens: 1500, system, tools: this.toolSchemas(), messages: msgs }),
+        headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.anthropic.apiKey!, 'anthropic-version': '2023-06-01', ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
+        body: JSON.stringify({ model: this.cfg.anthropic.model, max_tokens: this.cfg.anthropic.maxTokens, system, tools: this.toolSchemas(), messages: msgs,
+          ...(this.cfg.anthropic.effort ? { output_config: { effort: this.cfg.anthropic.effort } } : {}), ...(fallback ? { fallbacks: 'default' } : {}) }),
         signal: AbortSignal.timeout(60_000),
       });
       if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
-      const body = await r.json() as { content: any[]; stop_reason: string };
-      msgs.push({ role: 'assistant', content: body.content });
+      const body = await r.json() as { content: any[]; stop_reason: string; model?: string };
+      // Ablehnung oder abgeschnittene Antwort nie als Analyse ausgeben → Regelmodus mit Grund
+      if (body.stop_reason === 'refusal') throw new Error('Anfrage vom Modell abgelehnt (refusal)');
+      if (body.stop_reason === 'max_tokens') throw new Error('Antwort abgeschnitten (max_tokens)');
+      msgs.push({ role: 'assistant', content: body.content });  // unverändert zurückgeben (inkl. thinking-Blöcke)
       const calls = body.content.filter(c => c.type === 'tool_use');
       if (!calls.length || body.stop_reason !== 'tool_use') {
-        return { answer: body.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), mode: 'llm', toolsUsed: used, data };
+        const answer = body.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
+        if (!answer) throw new Error('leere Antwort');
+        return { answer, mode: 'llm', toolsUsed: used, data, model: body.model ?? this.cfg.anthropic.model };
       }
       const results = calls.map(c => {
         const fn = (this.tools as Record<string, (a: any) => unknown>)[c.name];
diff --git a/backend/src/engines/backtest.ts b/backend/src/engines/backtest.ts
index 818b1af..0e55840 100644
--- a/backend/src/engines/backtest.ts
+++ b/backend/src/engines/backtest.ts
@@ -13,38 +13,80 @@
  * Mischungen w·Modell + (1−w)·Markt (w aus Walk-Forward gewählt) · Schlusskurs (nur Referenz, nicht handelbar).
  * Unsicherheit: gepaarter Bootstrap (1000×, deterministisch) für Log-Loss-Differenzen.
  *
- * Validierung (VALIDATED) nur wenn ALLE gelten:
- *   echte Daten (kein Mock) · Holdout ≥ 300 je Markt · Ensemble signifikant besser als Basisrate (95-%-KI < 0) ·
- *   ECE < 0,05 · Marktquoten vorhanden und gewählte Mischung nicht signifikant schlechter als der Markt.
- *   Liefert das Modell keinen Mehrwert (w* = 0), bleibt das Ensemble UNVALIDATED und das empfohlene Modellgewicht ist 0.
+ * Validierung (v0.4.0) je WETTBEWERB × MARKT (Scope). Ein Scope ist VALIDATED nur wenn ALLE gelten:
+ *   echte Daten (kein Mock) · keine Datenqualitäts-Blocker des Wettbewerbs · Holdout ≥ 300 im Scope ·
+ *   Ensemble signifikant besser als Basisrate (95-%-KI < 0) · ECE < 0,05 · ≥ 300 Marktquoten zum Entscheidungszeitpunkt ·
+ *   gewähltes Mischgewicht > 0 · Mischung NICHT signifikant schlechter als der Markt.
+ *   "Nicht signifikant schlechter" ist KEIN Nachweis eines Mehrwerts: marketEvidence = NOT_WORSE.
+ *   Nur wenn die Mischung signifikant besser ist als der Markt (95-%-KI < 0): marketEvidence = BETTER (Voraussetzung für STRONG_VALUE).
+ *   Fehlende BTTS-Quoten machen nur die BTTS-Scopes UNVALIDATED, nicht 1X2/OU. Ungeprüfte Wettbewerbe bleiben UNVALIDATED.
+ *
+ * Live-Konsistenz (v0.4.0):
+ *   - Informationsstand: ein Spiel zählt erst als bekannt, wenn sein Ergebnis zum Entscheidungszeitpunkt vorlag
+ *     (Anstoß + RESULT_AVAILABLE_AFTER_MS ≤ Entscheidung) – "Anstoß vor Zielspiel" reicht bei laufenden Spielen nicht.
+ *   - Ensemble mit λ-Werten und derselben Stichprobengröße wie live (vorher gingen λ verloren → zu kleine Unsicherheit).
+ *   - Entscheidung über value.ts/decide() (Datenqualität, AVOID, Strategie-z) und Auswahl über recommendation.ts/selectTop()
+ *     (höchstens eine je Spiel, höchstens maxRecommendations je Auswahlfenster = Kalendertag des Entscheidungszeitpunkts in APP_TIMEZONE).
+ *   - CSV-Quotenzeitpunkte sind GESCHÄTZT (Anstoß − 24 h); das wird im Ergebnis ausgewiesen und ist kein exakter Verfügbarkeitsnachweis.
  */
 import type { Db } from '../db/db.js';
 import { Repository } from './repository.js';
 import type { HistMatch } from './prediction/history.js';
 import { buildElo, dixonColes, elo, featureModel, fitDixonColes, fitFeatureModel, poissonStrength, type ModelOutput } from './prediction/models.js';
 import { combine, type Weights } from './prediction/ensemble.js';
+import { computeDataQuality, type DataQuality } from './prediction/index.js';
 import { calibrationBins, ece } from './performance.js';
 import { OddsStore, consensusNoVig, type MarketBookView } from './odds.js';
-import { DEFAULT_MODEL_WEIGHT } from './value.js';
+import { DEFAULT_MODEL_WEIGHT, decide } from './value.js';
+import { selectTop } from './recommendation.js';
+import type { Strategy } from '../config.js';
 import { nowIso } from '../util/core.js';
 import { rng } from '../providers/mock.js';
 import type { MarketId, SelectionId } from '../providers/types.js';
 import { MARKET_SELECTIONS } from '../providers/types.js';
 
 export const DECISION_LEAD_MS = 60 * 60_000;
+/** Ein Ergebnis gilt erst 150 min nach Anstoß als bekannt (90 min + Pause + Nachspielzeit + Puffer für die Datenlieferung). */
+export const RESULT_AVAILABLE_AFTER_MS = 150 * 60_000;
+/** Spiele, deren Ergebnis zum Zeitpunkt `at` bereits vorlag (all aufsteigend nach Anstoß sortiert). */
+export function knownAt(all: HistMatch[], at: string): HistMatch[] {
+  const t = Date.parse(at) - RESULT_AVAILABLE_AFTER_MS;
+  let n = 0; while (n < all.length && Date.parse(all[n].kickoff) <= t) n++;
+  return all.slice(0, n);
+}
+export const MIN_SCOPE_HOLDOUT = 300;
 const MARKETS: MarketId[] = ['1X2', 'OU', 'BTTS'];
 const W_GRID = [0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
 
 type Outcome = Record<MarketId, SelectionId>;
 type P = Record<string, number>;
-interface Row {
-  eventId: number; competitionId: number; kickoff: string; segment: 'walk_forward' | 'holdout'; outcome: Outcome;
+export interface Row {
+  eventId: number; competitionId: number; kickoff: string; decisionAt: string; segment: 'walk_forward' | 'holdout'; outcome: Outcome;
+  /** Verfügbare Modellausgaben inkl. λ (für dieselbe Ensemble-Unsicherheit wie live) */
+  outputs: ModelOutput[];
   models: Record<string, Partial<Record<MarketId, P>>>;
-  ens: Partial<Record<MarketId, P>>; ensSd: Partial<Record<MarketId, P>>;
+  dq: DataQuality;
+  ens: Partial<Record<MarketId, P>>; ensSd: Partial<Record<MarketId, P>>; agreement: number;
   market: Partial<Record<MarketId, { probs: P; views: MarketBookView[] }>>;  // Entscheidungszeitpunkt
   closing: Partial<Record<MarketId, P>>;                                       // nur Referenz
 }
 
+export type ScopeStatus = 'VALIDATED' | 'UNVALIDATED' | 'FAILED';
+export type MarketEvidence = 'BETTER' | 'NOT_WORSE' | 'WORSE' | 'NOT_TESTABLE';
+export interface ScopeValidation {
+  competitionId: number; competition: string; market: MarketId; status: ScopeStatus; marketEvidence: MarketEvidence;
+  n: number; marketN: number; ece: number | null; vsBaseline: Cmp | null; blendVsMarket: Cmp | null; blendWeight: number | null;
+  oddsTimesEstimated: boolean; reasons: string[];
+}
+export interface BacktestOptions {
+  includeMock?: boolean; refitDays?: number; minEv?: number; now?: Date; minMatches?: number;
+  /** Blocker für ALLE Scopes (Altverhalten) */
+  blockers?: string[];
+  /** v0.4.0: Blocker je Wettbewerb (z. B. Duplikate, Data Leakage) – betreffen nur diesen Wettbewerb */
+  blockersByCompetition?: Record<number, string[]>;
+  strategy?: Strategy; modelWeight?: number | null; maxRecommendations?: number; timezone?: string;
+}
+
 interface Score { n: number; logLoss: number; brier: number }
 interface Cmp { diff: number; lo: number; hi: number; n: number }
 
@@ -66,10 +108,19 @@ export interface BacktestMetrics {
   betting: null | {
     simulated: true; complete: boolean; decisionRule: string; bets: number; qualifiedSignals: number; wins: number; profit: number; roi: number | null; yield: number | null;
     avgOdds: number | null; maxDrawdown: number; avgClv: number | null; clvCount: number; byMarket: Record<string, { bets: number; profit: number; roi: number | null }>; note: string;
+    /** v0.4.0: Auswahl wie live */
+    selection?: { rule: string; windows: number; maxPerWindow: number; maxBetsInAWindow: number; maxBetsPerEvent: number;
+      excluded: { insufficientData: number; avoid: number; watchOrNoValue: number; correlatedSameEvent: number; beyondWindowLimit: number } };
+    oddsTimes?: { estimatedShare: number; note: string };
   };
   bettingIncompleteReason: string | null;
   recommendedModelWeight: number | null;
-  validation: { status: 'VALIDATED' | 'UNVALIDATED' | 'FAILED'; reasons: string[] };
+  /** Gesamtstatus: VALIDATED nur wenn ALLE Scopes validiert; PARTIAL wenn mindestens einer. Live zählt nur der Scope. */
+  validation: { status: 'VALIDATED' | 'PARTIAL' | 'UNVALIDATED' | 'FAILED'; reasons: string[] };
+  /** v0.4.0 */
+  scopes?: ScopeValidation[];
+  blendWeightByMarket?: Partial<Record<MarketId, number | null>>;
+  informationCutoffMinutes?: number;
 }
 
 const outcomeOf = (m: HistMatch): Outcome => ({
@@ -83,9 +134,11 @@ const blendP = (m: P, k: P, w: number, sels: string[]): P => Object.fromEntries(
 
 export class BacktestingEngine {
   private repo: Repository; private odds: OddsStore;
+  /** Zeilen des letzten Laufs (nur für Tests und Diagnose; nicht persistiert). */
+  lastRows: Row[] = [];
   constructor(private db: Db) { this.repo = new Repository(db); this.odds = new OddsStore(db); }
 
-  run(opts: { includeMock?: boolean; refitDays?: number; minEv?: number; now?: Date; minMatches?: number; blockers?: string[] } = {}): { runId: number; metrics: BacktestMetrics } {
+  run(opts: BacktestOptions = {}): { runId: number; metrics: BacktestMetrics } {
     const now = opts.now ?? new Date();
     const minM = opts.minMatches ?? 200;
     const comps = this.db.all<{ id: number; is_mock: number; name: string }>(`SELECT c.id, c.is_mock, c.name FROM competitions c WHERE ${opts.includeMock ? '1=1' : 'c.is_mock = 0'}
@@ -95,7 +148,8 @@ export class BacktestingEngine {
     try {
       const rows: Row[] = [];
       for (const c of comps) rows.push(...this.walkForward(c.id, opts.refitDays ?? 14, minM));
-      const metrics = this.evaluate(rows, dataSource, comps, opts.minEv ?? 0.05, opts.blockers ?? []);
+      this.lastRows = rows;
+      const metrics = this.evaluate(rows, dataSource, comps, opts);
       this.db.run('UPDATE backtest_runs SET status = ?, finished_at = ?, metrics = ? WHERE id = ?', 'done', nowIso(), JSON.stringify(metrics), runId);
       this.storeModelVersion(runId, metrics);
       return { runId, metrics };
@@ -112,7 +166,7 @@ export class BacktestingEngine {
 
   /** Marktsicht zum Entscheidungszeitpunkt (nur live/pre_closing, abgerufen vor decisionAt). */
   private marketAt(eventId: number, m: MarketId, decisionAt: string) {
-    const views = this.odds.latestPerBookmaker(eventId, m, m === 'OU' ? 2.5 : null, decisionAt, ['live', 'pre_closing']).filter(v => v.valid);
+    const views = this.odds.latestPerBookmaker(eventId, m, m === 'OU' ? 2.5 : null, decisionAt, ['live', 'pre_closing']).filter(v => v.valid && v.status === 'open');
     const c = consensusNoVig(views, m);
     return c ? { probs: c.probs as P, views } : undefined;
   }
@@ -128,36 +182,44 @@ export class BacktestingEngine {
     const holdoutStart = all[Math.floor(all.length * 0.75)].kickoff;
     const rows: Row[] = [];
     let i = burnIn;
+    const lead = (k: string) => new Date(Date.parse(k) - DECISION_LEAD_MS).toISOString();
     while (i < all.length) {
       const windowStart = all[i].kickoff;
       const windowEnd = new Date(new Date(windowStart).getTime() + refitDays * 86_400_000).toISOString();
-      const train = all.filter(m => m.kickoff < windowStart);
-      const dc = fitDixonColes(train, windowStart), el = buildElo(train, windowStart), ft = fitFeatureModel(train, windowStart);
+      // Parameter nur aus Spielen, deren Ergebnis zum FRÜHESTEN Entscheidungszeitpunkt des Fensters bekannt war
+      const fitAt = lead(windowStart);
+      const train = knownAt(all, fitAt);
+      const dc = fitDixonColes(train, fitAt), el = buildElo(train, fitAt), ft = fitFeatureModel(train, fitAt);
       for (; i < all.length && all[i].kickoff < windowEnd; i++) {
         const m = all[i];
-        const seen = all.slice(0, i);
+        const decisionAt = lead(m.kickoff);
+        const seen = knownAt(all, decisionAt);
         const outs: ModelOutput[] = [
-          poissonStrength(seen, m.home, m.away, m.kickoff, !!m.neutral),
-          dixonColes(dc, train, m.home, m.away, windowStart, !!m.neutral),
+          poissonStrength(seen, m.home, m.away, decisionAt, !!m.neutral),
+          dixonColes(dc, train, m.home, m.away, fitAt, !!m.neutral),
           elo(el, m.home, m.away, !!m.neutral),
-          featureModel(ft, seen, m.home, m.away, m.kickoff, !!m.neutral),
+          featureModel(ft, seen, m.home, m.away, decisionAt, !!m.neutral),
         ];
+        const avail = outs.filter(o => o.available && o.probs);
+        if (!avail.length) continue;
         const models: Row['models'] = {};
-        for (const o of outs) if (o.available && o.probs) models[o.model] = Object.fromEntries(Object.entries(o.probs).map(([k, v]) => [k, v as P]));
-        if (!Object.keys(models).length) continue;
-        const decisionAt = new Date(new Date(m.kickoff).getTime() - DECISION_LEAD_MS).toISOString();
+        for (const o of avail) models[o.model] = Object.fromEntries(Object.entries(o.probs!).map(([k, v]) => [k, v as P]));
+        // Historische Aufstellungen sind unbekannt → wie ein Live-Spiel ohne Aufstellung bewertet (konservativ)
+        const dq = computeDataQuality(seen, m.home, m.away, decisionAt, outs, 'none');
         const market: Row['market'] = {}, closing: Row['closing'] = {};
         for (const mk of MARKETS) {
           const a = this.marketAt(m.eventId, mk, decisionAt); if (a) market[mk] = a;
           const c = this.closingAt(m.eventId, mk, m.kickoff); if (c) closing[mk] = c;
         }
-        rows.push({ eventId: m.eventId, competitionId, kickoff: m.kickoff, segment: m.kickoff >= holdoutStart ? 'holdout' : 'walk_forward', outcome: outcomeOf(m), models, ens: {}, ensSd: {}, market, closing });
+        rows.push({ eventId: m.eventId, competitionId, kickoff: m.kickoff, decisionAt, segment: m.kickoff >= holdoutStart ? 'holdout' : 'walk_forward', outcome: outcomeOf(m),
+          outputs: avail, models, dq, ens: {}, ensSd: {}, agreement: 0, market, closing });
       }
     }
     return rows;
   }
 
-  private evaluate(rows: Row[], dataSource: string, comps: { id: number; name: string }[], minEv: number, blockers: string[] = []): BacktestMetrics {
+  private evaluate(rows: Row[], dataSource: string, comps: { id: number; name: string }[], opts: BacktestOptions): BacktestMetrics {
+    const minEv = opts.minEv ?? 0.05;
     const wf = rows.filter(r => r.segment === 'walk_forward'), ho = rows.filter(r => r.segment === 'holdout');
     const modelNames = ['poisson', 'dixon_coles', 'elo', 'feature'];
     const score = (set: Row[], get: (r: Row) => P | undefined, m: MarketId): Score | null => {
@@ -186,13 +248,14 @@ export class BacktestingEngine {
         weights[m] = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, +(v / sum).toFixed(4)]));
       }
     }
-    // Ensemble je Zeile (mit Walk-Forward-Gewichten)
+    // Ensemble je Zeile wie live: vollständige Modellausgaben (inkl. λ) und Stichprobe = kleinere Teamhistorie
     for (const r of rows) {
-      const c = combine(Object.entries(r.models).map(([model, probs]) => ({ model: model as ModelOutput['model'], available: true, probs: probs as ModelOutput['probs'] })), weights, 30);
-      r.ens = c.probs as Row['ens']; r.ensSd = c.sd as Row['ensSd'];
+      const c = combine(r.outputs, weights, Math.min(r.dq.homeGames, r.dq.awayGames));
+      r.ens = c.probs as Row['ens']; r.ensSd = c.sd as Row['ensSd']; r.agreement = c.agreement;
     }
     const holdoutEnsemble: BacktestMetrics['holdoutEnsemble'] = {}, market: BacktestMetrics['market'] = {}, blend: BacktestMetrics['blend'] = {}, comparisons: BacktestMetrics['comparisons'] = {};
     let seed = 0;
+    const blendWeightByMarket: Partial<Record<MarketId, number | null>> = {};
     for (const m of MARKETS) {
       const sels = MARKET_SELECTIONS[m];
       const s = score(ho, r => r.ens[m], m);
@@ -206,6 +269,7 @@ export class BacktestingEngine {
       const wfM = wf.filter(r => r.market[m] && r.ens[m]);
       const byW = wfM.length >= 50 ? W_GRID.map(w => ({ w, logLoss: wfM.reduce((a, r) => a + ll1(blendP(r.ens[m]!, r.market[m]!.probs, w, sels), r.outcome[m]), 0) / wfM.length })) : [];
       const chosen = byW.length ? byW.reduce((a, b) => (b.logLoss < a.logLoss - 1e-9 ? b : a)).w : null;
+      blendWeightByMarket[m] = chosen;
       const blendHo = chosen != null ? score(withMkt, r => blendP(r.ens[m]!, r.market[m]!.probs, chosen, sels), m) : null;
       blend[m] = { chosenWeight: chosen, walkForwardByWeight: byW.map(x => ({ w: x.w, logLoss: +x.logLoss.toFixed(5) })), holdout: blendHo,
         vsMarket: chosen != null ? pairedBootstrap(withMkt.map(r => ll1(blendP(r.ens[m]!, r.market[m]!.probs, chosen, sels), r.outcome[m]) - ll1(r.market[m]!.probs, r.outcome[m])), `b${m}${seed++}`) : null };
@@ -227,81 +291,137 @@ export class BacktestingEngine {
         })) };
     }).filter(c => c.holdout > 0);
 
-    // Wettsimulation: nur mit zeitlich gültigen Quoten, gleiche Entscheidungsregel wie live
+    // Wettsimulation: nur mit zeitlich gültigen Quoten, gleiche Entscheidungs- UND Auswahlregel wie live
     const anyDecisionOdds = ho.some(r => MARKETS.some(m => r.market[m]));
-    const modelWeight = DEFAULT_MODEL_WEIGHT.BALANCED;
-    const betting = anyDecisionOdds ? this.simulateBets(ho, modelWeight, minEv) : null;
+    const strategy = opts.strategy ?? 'BALANCED';
+    const betting = anyDecisionOdds ? this.simulateBets(ho, { strategy, modelWeight: opts.modelWeight ?? DEFAULT_MODEL_WEIGHT[strategy], minEv, max: opts.maxRecommendations ?? 5, timezone: opts.timezone ?? 'America/Asuncion' }) : null;
     const bettingIncompleteReason = anyDecisionOdds ? null : 'UNVOLLSTÄNDIG: keine zeitlich gültigen Quoten zum Entscheidungszeitpunkt – keine historische Rendite berechnet';
 
-    // Validierung
-    const reasons: string[] = [];
-    let failed = false, unvalidated = false;
-    const degrade = (to: 'UNVALIDATED' | 'FAILED', why: string) => { reasons.push(why); if (to === 'FAILED') failed = true; else unvalidated = true; };
-    if (dataSource === 'mock' || dataSource === 'mixed') degrade('UNVALIDATED', 'Mock-Daten: keine gültige historische Validierung möglich');
-    // v0.3.0: Datenqualitäts-Befunde (z. B. Duplikate, Data Leakage) verhindern VALIDATED
-    for (const b of blockers) degrade('UNVALIDATED', `Datenqualität: ${b}`);
-    for (const m of MARKETS) {
-      const e = holdoutEnsemble[m], c = comparisons[m];
-      if (!e || e.n < 300) degrade('UNVALIDATED', `${m}: zu kleiner Holdout (${e?.n ?? 0} Spiele, mindestens 300)`);
-      else {
-        if (!c?.ensembleVsBaseline || c.ensembleVsBaseline.hi >= 0) degrade('FAILED', `${m}: Ensemble nicht signifikant besser als die Basisrate (ΔLogLoss ${fmtCmp(c?.ensembleVsBaseline)})`);
-        if (e.ece >= 0.05) degrade('FAILED', `${m}: Kalibrierungsfehler ECE ${e.ece.toFixed(3)} ≥ 0,05`);
-      }
-      const mk = market[m];
-      if (!mk || mk.n < 300) degrade('UNVALIDATED', `${m}: zu wenige Marktquoten zum Entscheidungszeitpunkt (${mk?.n ?? 0}) – Mehrwert gegenüber dem Markt nicht prüfbar`);
-      else {
-        const b = blend[m]!;
-        if (b.chosenWeight === 0) degrade('UNVALIDATED', `${m}: Modell liefert keinen Mehrwert gegenüber dem Markt (optimales Gewicht 0)`);
-        if (b.vsMarket && b.vsMarket.lo > 0) degrade('FAILED', `${m}: Mischung signifikant schlechter als der Markt (${fmtCmp(b.vsMarket)})`);
-      }
-    }
-    // Mock-Daten können nie validieren (auch nicht "FAILED" im Sinne eines echten Tests); sonst FAILED vor UNVALIDATED
+    // Validierung je Wettbewerb × Markt
     const mock = dataSource === 'mock' || dataSource === 'mixed';
-    const status: 'VALIDATED' | 'UNVALIDATED' | 'FAILED' = mock ? 'UNVALIDATED' : failed ? 'FAILED' : unvalidated ? 'UNVALIDATED' : 'VALIDATED';
-    if (status === 'VALIDATED') reasons.push('Holdout signifikant besser als die Basisrate, gut kalibriert und mit Mehrwert gegenüber dem Markt');
-    const ws = MARKETS.map(m => blend[m]?.chosenWeight).filter((x): x is number => x != null);
-    const recommendedModelWeight = ws.length ? Math.min(...ws) : null; // konservativ: kleinstes Gewicht über alle Märkte
+    const scopes: ScopeValidation[] = [];
+    for (const c of comps) for (const m of MARKETS) scopes.push(this.validateScope(c, m, ho, baseP[m]!, blendWeightByMarket[m] ?? null, mock, [...(opts.blockers ?? []), ...(opts.blockersByCompetition?.[c.id] ?? [])], seed++));
+    const nVal = scopes.filter(x => x.status === 'VALIDATED').length;
+    const status: BacktestMetrics['validation']['status'] = mock || !scopes.length ? 'UNVALIDATED' : nVal === scopes.length ? 'VALIDATED' : nVal > 0 ? 'PARTIAL'
+      : scopes.some(x => x.status === 'FAILED') ? 'FAILED' : 'UNVALIDATED';
+    const reasons: string[] = [];
+    if (mock) reasons.push('Mock-Daten: keine gültige historische Validierung möglich');
+    if (!scopes.length) reasons.push('Kein Wettbewerb mit ausreichender Historie: nichts validiert');
+    for (const b of opts.blockers ?? []) reasons.push(`Datenqualität: ${b}`);
+    for (const x of scopes) for (const r of x.reasons) reasons.push(`${x.competition} · ${x.market}: ${r}`);
+    if (status === 'VALIDATED' || status === 'PARTIAL') reasons.push(`${nVal} von ${scopes.length} Bereichen (Wettbewerb × Markt) validiert. Nur diese Bereiche gelten live als validiert; alle anderen bleiben UNVALIDATED.`);
+    const ws = MARKETS.map(m => blendWeightByMarket[m]).filter((x): x is number => x != null);
+    const recommendedModelWeight = ws.length ? Math.min(...ws) : null; // Altfeld: konservativ kleinstes Gewicht
     return {
       version: '0.3.0', dataSource, competitions: comps.length, matches: { walkForward: wf.length, holdout: ho.length }, decisionLeadMinutes: DECISION_LEAD_MS / 60_000,
       byModel, baseline, weights, holdoutEnsemble, holdoutModels, market, blend, comparisons, byCompetition, betting, bettingIncompleteReason, recommendedModelWeight,
-      validation: { status, reasons },
+      validation: { status, reasons: [...new Set(reasons)] }, scopes, blendWeightByMarket, informationCutoffMinutes: RESULT_AVAILABLE_AFTER_MS / 60_000,
     };
   }
 
-  /** Flat 1u; Entscheidungsregel wie live: p_dec = w·Modell + (1−w)·Markt ohne den bewerteten Buchmacher, EV ≥ minEv UND EV-Untergrenze > 0. */
-  private simulateBets(ho: Row[], w: number, minEv: number): NonNullable<BacktestMetrics['betting']> {
-    let bets = 0, wins = 0, profit = 0, peak = 0, dd = 0, oddsSum = 0, clvSum = 0, clvN = 0, qualified = 0;
-    const byMarket: Record<string, { bets: number; profit: number; roi: number | null }> = {};
-    let complete = true;
+  /** Validierung eines Bereichs (Wettbewerb × Markt). Ohne ausreichenden Nachweis: UNVALIDATED. */
+  private validateScope(c: { id: number; name: string }, m: MarketId, ho: Row[], baseP: P, w: number | null, mock: boolean, blockers: string[], seed: number): ScopeValidation {
+    const sels = MARKET_SELECTIONS[m];
+    const h = ho.filter(r => r.competitionId === c.id && r.ens[m]);
+    const hm = h.filter(r => r.market[m]);
+    const items = h.flatMap(r => sels.map(sel => ({ p: r.ens[m]![sel], y: r.outcome[m] === sel ? 1 : 0 })));
+    const e = items.length ? ece(items) : null;
+    const vsBaseline = h.length ? pairedBootstrap(h.map(r => ll1(r.ens[m], r.outcome[m]) - ll1(baseP, r.outcome[m])), `s${c.id}${m}b${seed}`) : null;
+    const blendVsMarket = w != null && hm.length ? pairedBootstrap(hm.map(r => ll1(blendP(r.ens[m]!, r.market[m]!.probs, w, sels), r.outcome[m]) - ll1(r.market[m]!.probs, r.outcome[m])), `s${c.id}${m}m${seed}`) : null;
+    const estimated = hm.length > 0 && hm.some(r => r.market[m]!.views.some(v => v.timeEstimated));
+    const reasons: string[] = [];
+    let failed = false, unval = false;
+    const no = (why: string) => { reasons.push(why); unval = true; };
+    const fail = (why: string) => { reasons.push(why); failed = true; };
+    if (mock) no('Mock-Daten');
+    for (const b of blockers) no(`Datenqualität: ${b}`);
+    if (h.length < MIN_SCOPE_HOLDOUT) no(`zu kleiner Holdout (${h.length} Spiele, mindestens ${MIN_SCOPE_HOLDOUT})`);
+    else {
+      if (!vsBaseline || vsBaseline.hi >= 0) fail(`Ensemble nicht signifikant besser als die Basisrate (ΔLogLoss ${fmtCmp(vsBaseline)})`);
+      if (e != null && e >= 0.05) fail(`Kalibrierungsfehler ECE ${e.toFixed(3)} ≥ 0,05`);
+    }
+    let evidence: MarketEvidence = 'NOT_TESTABLE';
+    if (hm.length < MIN_SCOPE_HOLDOUT) no(`zu wenige Marktquoten zum Entscheidungszeitpunkt (${hm.length}) – Vergleich mit dem Markt nicht prüfbar`);
+    else if (w === 0) no('Modell liefert keinen Mehrwert gegenüber dem Markt (optimales Gewicht 0)');
+    else if (blendVsMarket) {
+      evidence = blendVsMarket.lo > 0 ? 'WORSE' : blendVsMarket.hi < 0 ? 'BETTER' : 'NOT_WORSE';
+      if (evidence === 'WORSE') fail(`Mischung signifikant schlechter als der Markt (${fmtCmp(blendVsMarket)})`);
+    }
+    if (estimated) reasons.push('Quotenzeitpunkte geschätzt (CSV: Anstoß − 24 h) – kein exakter Nachweis der historischen Verfügbarkeit');
+    const status: ScopeStatus = mock || unval ? (failed && !mock ? 'FAILED' : 'UNVALIDATED') : failed ? 'FAILED' : 'VALIDATED';
+    if (status === 'VALIDATED') reasons.push(evidence === 'BETTER'
+      ? 'signifikant besser als Basisrate, kalibriert und Mischung signifikant besser als der Markt (Mehrwert im Holdout belegt)'
+      : 'signifikant besser als Basisrate und kalibriert; Mischung NICHT signifikant schlechter als der Markt – das ist KEIN Nachweis eines Mehrwerts gegenüber dem Markt');
+    return { competitionId: c.id, competition: c.name, market: m, status, marketEvidence: evidence, n: h.length, marketN: hm.length, ece: e, vsBaseline, blendVsMarket, blendWeight: w, oddsTimesEstimated: estimated, reasons };
+  }
+
+  /**
+   * Flat 1u, Entscheidung wie live (value.ts/decide) und Auswahl wie live (recommendation.ts/selectTop):
+   * Datenqualität, Unsicherheit (Strategie-z), AVOID-Regel, höchstens eine Wette je Spiel und höchstens `max` je Auswahlfenster.
+   * Auswahlfenster = Kalendertag des Entscheidungszeitpunkts in der App-Zeitzone (live: jeder Lauf zeigt höchstens 5 aktive Empfehlungen).
+   * Unterschiede zu live (ausgewiesen): Quotenfrische fließt mit 0 in den Qualitätswert ein (Zeitpunkte geschätzt), keine Aufstellungen.
+   */
+  private simulateBets(ho: Row[], o: { strategy: Strategy; modelWeight: number; minEv: number; max: number; timezone: string }): NonNullable<BacktestMetrics['betting']> {
+    type Cand = { id: number; event_id: number; ev_low: number | null; quality_score: number; row: Row; m: MarketId; sel: SelectionId; odds: number; window: string };
+    const ex = { insufficientData: 0, avoid: 0, watchOrNoValue: 0, correlatedSameEvent: 0, beyondWindowLimit: 0 };
+    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: o.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
+    const cands: Cand[] = [];
+    let complete = true, seq = 0, viewsUsed = 0, viewsEstimated = 0;
     for (const r of ho) for (const m of MARKETS) {
       const mk = r.market[m], pm = r.ens[m], sd = r.ensSd[m];
       if (!pm) continue;
       if (!mk) { complete = false; continue; }
+      if (r.dq.status === 'insufficient') { ex.insufficientData += MARKET_SELECTIONS[m].length; continue; }
       for (const sel of MARKET_SELECTIONS[m]) {
         const best = mk.views.reduce<MarketBookView | null>((a, v) => (v.prices[sel] ?? 0) > (a?.prices[sel] ?? 0) ? v : a, null);
         if (!best) continue;
-        const odds = best.prices[sel]!;
         const ref = consensusNoVig(mk.views, m, best.bookmakerId);
-        const pDec = ref ? w * pm[sel] + (1 - w) * ref.probs[sel]! : pm[sel];
-        const sDec = ref ? Math.sqrt((w * (sd?.[sel] ?? 0.05)) ** 2 + ((1 - w) * 0.015) ** 2) : (sd?.[sel] ?? 0.05);
-        const ev = pDec * odds - 1, evLow = (pDec - sDec) * odds - 1;
-        if (ev < minEv || evLow <= 0) continue;
-        qualified++;
-        bets++; oddsSum += odds;
-        const won = r.outcome[m] === sel;
-        if (won) wins++;
-        const pl = won ? odds - 1 : -1;
-        profit += pl; peak = Math.max(peak, profit); dd = Math.max(dd, peak - profit);
-        const bm = (byMarket[m] ??= { bets: 0, profit: 0, roi: null }); bm.bets++; bm.profit += pl; bm.roi = bm.profit / bm.bets;
-        const close = r.closing[m]?.[sel];
-        if (close) { clvSum += odds * close - 1; clvN++; } // erwarteter Wert zum fairen Schlusskurs
+        const d = decide({ p: pm[sel], sd: sd?.[sel] ?? null, bestOdds: best.prices[sel]!, novig: ref?.probs[sel] ?? null, strategy: o.strategy, minEv: o.minEv, modelWeight: o.modelWeight,
+          dqScore: r.dq.score, agreement: r.agreement, modelValidated: false, marketEdgeProven: false, isMock: false, freshness: 0, freshBooks: mk.views.length, marketRefSource: ref?.source ?? null });
+        if (d.status === 'AVOID') { ex.avoid++; continue; }
+        if (d.status !== 'VALUE' && d.status !== 'STRONG_VALUE') { ex.watchOrNoValue++; continue; }
+        viewsUsed++; if (best.timeEstimated) viewsEstimated++;
+        cands.push({ id: seq++, event_id: r.eventId, ev_low: d.evLow, quality_score: d.qualityScore, row: r, m, sel, odds: best.prices[sel]!, window: dayOf.format(new Date(r.decisionAt)) });
       }
     }
+    const byWindow = new Map<string, Cand[]>();
+    for (const c of cands) byWindow.set(c.window, [...(byWindow.get(c.window) ?? []), c]);
+    const bets: Cand[] = [];
+    let maxInWindow = 0;
+    for (const list of [...byWindow.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1])) {
+      const all = selectTop(list, Number.MAX_SAFE_INTEGER), top = all.slice(0, o.max);
+      ex.correlatedSameEvent += all.reduce((a, t) => a + t.correlated.length, 0);
+      ex.beyondWindowLimit += all.length - top.length;
+      bets.push(...top.map(t => t.pick)); maxInWindow = Math.max(maxInWindow, top.length);
+    }
+    bets.sort((a, b) => a.row.kickoff.localeCompare(b.row.kickoff) || a.id - b.id);
+    let wins = 0, profit = 0, peak = 0, dd = 0, oddsSum = 0, clvSum = 0, clvN = 0;
+    const byMarket: Record<string, { bets: number; profit: number; roi: number | null }> = {};
+    const perEvent = new Map<number, number>();
+    for (const b of bets) {
+      perEvent.set(b.event_id, (perEvent.get(b.event_id) ?? 0) + 1);
+      oddsSum += b.odds;
+      const won = b.row.outcome[b.m] === b.sel;
+      if (won) wins++;
+      const pl = won ? b.odds - 1 : -1;
+      profit += pl; peak = Math.max(peak, profit); dd = Math.max(dd, peak - profit);
+      const bm = (byMarket[b.m] ??= { bets: 0, profit: 0, roi: null }); bm.bets++; bm.profit += pl; bm.roi = bm.profit / bm.bets;
+      const close = b.row.closing[b.m]?.[b.sel];
+      if (close) { clvSum += b.odds * close - 1; clvN++; } // erwarteter Wert zum fairen Schlusskurs
+    }
+    const n = bets.length;
+    const estShare = viewsUsed ? viewsEstimated / viewsUsed : 0;
     return {
-      simulated: true, complete, decisionRule: `p_dec = ${w}·Modell + ${1 - w}·Markt (ohne bewerteten Buchmacher); EV ≥ ${(minEv * 100).toFixed(0)} %; EV-Untergrenze > 0; Entscheidung ${DECISION_LEAD_MS / 60_000} min vor Anstoß`,
-      bets, qualifiedSignals: qualified, wins, profit: +profit.toFixed(2), roi: bets ? profit / bets : null, yield: bets ? profit / bets : null, avgOdds: bets ? oddsSum / bets : null,
+      simulated: true, complete,
+      decisionRule: `wie live (decide): Strategie ${o.strategy}, p_dec = ${o.modelWeight}·Modell + ${+(1 - o.modelWeight).toFixed(2)}·Markt (ohne bewerteten Buchmacher); EV ≥ ${(o.minEv * 100).toFixed(0)} %; EV-Untergrenze > 0; Datenqualität ≥ Mindestwert; AVOID bei > 12 Pp. Abweichung; Entscheidung ${DECISION_LEAD_MS / 60_000} min vor Anstoß`,
+      bets: n, qualifiedSignals: cands.length, wins, profit: +profit.toFixed(2), roi: n ? profit / n : null, yield: n ? profit / n : null, avgOdds: n ? oddsSum / n : null,
       maxDrawdown: +dd.toFixed(2), avgClv: clvN ? clvSum / clvN : null, clvCount: clvN, byMarket,
-      note: 'SIMULIERT im Holdout gegen zum Entscheidungszeitpunkt verfügbare (Pre-Closing-)Quoten mit geschätztem Erfassungszeitpunkt. Keine echte Performance.' + (complete ? '' : ' Nicht für alle Spiele lagen Quoten vor (UNVOLLSTÄNDIG).'),
+      note: 'SIMULIERT im Holdout gegen zum Entscheidungszeitpunkt verfügbare (Pre-Closing-)Quoten. Keine echte Performance.'
+        + (estShare > 0 ? ` Quotenzeitpunkte zu ${(estShare * 100).toFixed(0)} % GESCHÄTZT (kein exakter Verfügbarkeitsnachweis).` : '')
+        + (complete ? '' : ' Nicht für alle Spiele lagen Quoten vor (UNVOLLSTÄNDIG).'),
+      selection: { rule: `höchstens 1 je Spiel, höchstens ${o.max} je Auswahlfenster (Kalendertag des Entscheidungszeitpunkts, ${o.timezone}); Rang = EV-Untergrenze × Qualität`,
+        windows: byWindow.size, maxPerWindow: o.max, maxBetsInAWindow: maxInWindow, maxBetsPerEvent: Math.max(0, ...perEvent.values()), excluded: ex },
+      oddsTimes: { estimatedShare: estShare, note: estShare > 0 ? 'Geschätzte Erfassungszeitpunkte (football-data.co.uk: Anstoß − 24 h). Belegen keine exakte historische Verfügbarkeit.' : 'Erfassungszeitpunkte aus echten Abrufen.' },
     };
   }
 
@@ -309,7 +429,11 @@ export class BacktestingEngine {
     const id = `ensemble-1.1.0+bt${runId}`;
     // v0.3.0: Modellversionen sind unveränderlich (Trigger); jede Backtest-Version bekommt eine eigene ID
     this.db.run('INSERT INTO model_versions (id, description, weights, validation_status, validated_by_backtest) VALUES (?, ?, ?, ?, ?)',
-      id, `Gewichte aus Backtest #${runId} (${m.dataSource})`, JSON.stringify({ ...m.weights, blendWeight: m.recommendedModelWeight }), m.validation.status, runId);
+      id, `Gewichte aus Backtest #${runId} (${m.dataSource})`, JSON.stringify({ ...m.weights, blendWeight: m.recommendedModelWeight, blendWeightByMarket: m.blendWeightByMarket ?? {} }), m.validation.status, runId);
+    // v0.4.0: Status je Wettbewerb × Markt (unveränderlich, append-only)
+    for (const s of m.scopes ?? [])
+      this.db.run(`INSERT INTO model_scope_validations (model_version_id, backtest_run_id, competition_id, market_id, status, market_evidence, holdout_n, market_n, blend_weight, odds_times_estimated, reasons, created_at)
+        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, runId, s.competitionId, s.market, s.status, s.marketEvidence, s.n, s.marketN, s.blendWeight, s.oddsTimesEstimated ? 1 : 0, JSON.stringify(s.reasons), nowIso());
   }
 
   latest(): { id: number; started_at: string; finished_at: string | null; status: string; data_source: string; metrics: BacktestMetrics | null } | null {
diff --git a/backend/src/engines/coverage.ts b/backend/src/engines/coverage.ts
new file mode 100644
index 0000000..c1eab7c
--- /dev/null
+++ b/backend/src/engines/coverage.ts
@@ -0,0 +1,112 @@
+/**
+ * Datengrundlage je Wettbewerb (v0.4.0) – ehrliche Übersicht für Betrieb und Admin.
+ *
+ * Je Wettbewerb: Spielplan verfügbar? Quoten verfügbar? Historie vorhanden? Teams eindeutig zugeordnet?
+ * Modelle berechenbar? Markt und Wettbewerb validiert?
+ * Ausschließlich aus der Datenbank und der Konfiguration abgeleitet; nichts wird geschätzt oder ergänzt.
+ *
+ * Wettbewerbe ohne geeignete eigene Historie (z. B. UEFA Champions League – football-data.co.uk bietet keine CSV)
+ * erhalten INSUFFICIENT DATA mit Erklärung. Modelle nationaler Ligen werden NICHT übertragen: die Prognose nutzt
+ * ausschließlich die Historie desselben (verknüpften) Wettbewerbs.
+ */
+import type { Db } from '../db/db.js';
+import type { Config } from '../config.js';
+import { effectiveSportKeys } from '../config.js';
+import type { MarketId } from '../providers/types.js';
+import { linkSimilarity } from './linking.js';
+
+export const MIN_LEAGUE_HISTORY = 80;   // Dixon-Coles/Feature-Modell: mindestens 80 Ligaspiele
+export const MIN_TEAM_GAMES = 6;        // alle Modelle: mindestens 6 Spiele je Team
+const MARKETS: MarketId[] = ['1X2', 'OU', 'BTTS'];
+
+export type CoverageStatus = 'READY' | 'PARTIAL' | 'INSUFFICIENT DATA' | 'NO FIXTURES';
+export interface CompetitionCoverage {
+  competitionId: number | null; name: string; providers: string[]; sportKey: string | null; isMock: boolean;
+  fixtures: { available: boolean; upcoming: number; nextKickoff: string | null };
+  odds: { available: boolean; eventsWithOdds: number; byMarket: Record<MarketId, number>; newestRetrievedAt: string | null };
+  history: { available: boolean; finishedMatches: number; seasons: number; sources: string[] };
+  teams: { unique: boolean; upcomingTeams: number; withoutHistory: string[]; unlinked: number; possibleDuplicates: number };
+  models: { computable: boolean; eventsComputable: number; eventsTotal: number; reason: string | null };
+  validation: Record<MarketId, { status: 'VALIDATED' | 'UNVALIDATED' | 'FAILED'; marketEvidence: string | null; modelVersion: string | null }>;
+  status: CoverageStatus; explanation: string[];
+}
+
+const isIntlClubCup = (name: string, key: string | null) => /champions league|europa league|conference league|libertadores|sudamericana|club world/i.test(name) || /uefa|conmebol|fifa/i.test(key ?? '');
+
+export function competitionCoverage(db: Db, cfg: Config, now: Date = new Date()): { generatedAt: string; competitions: CompetitionCoverage[]; notes: string[] } {
+  const live = cfg.dataMode === 'live';
+  const horizon = new Date(now.getTime() + cfg.analysis.horizonHours * 3_600_000).toISOString(), t = now.toISOString();
+  const comps = db.all<{ id: number; name: string; is_mock: number }>(`SELECT id, name, is_mock FROM competitions ${live ? 'WHERE is_mock = 0' : ''} ORDER BY name`);
+  const out: CompetitionCoverage[] = [];
+  for (const c of comps) {
+    const aliases = db.all<{ provider: string; provider_id: string }>('SELECT provider, provider_id FROM competition_aliases WHERE competition_id = ?', c.id);
+    const sportKey = aliases.find(a => a.provider === 'theoddsapi')?.provider_id ?? null;
+    const up = db.all<{ id: number; kickoff_utc: string; home_team_id: number; away_team_id: number; home: string; away: string }>(
+      `SELECT e.id, e.kickoff_utc, e.home_team_id, e.away_team_id, th.name AS home, ta.name AS away FROM events e JOIN teams th ON th.id = e.home_team_id JOIN teams ta ON ta.id = e.away_team_id
+        WHERE e.competition_id = ? AND e.status = 'scheduled' AND e.kickoff_utc > ? AND e.kickoff_utc <= ? ORDER BY e.kickoff_utc`, c.id, t, horizon);
+    const fin = db.get<{ n: number; seasons: number }>("SELECT COUNT(*) AS n, COUNT(DISTINCT season) AS seasons FROM events WHERE competition_id = ? AND status = 'finished' AND home_goals IS NOT NULL", c.id)!;
+    if (!up.length && !fin.n) continue;
+    const histSources = db.all<{ provider: string }>(`SELECT DISTINCT m.provider FROM event_mappings m JOIN events e ON e.id = m.event_id WHERE e.competition_id = ? AND e.status = 'finished'`, c.id).map(r => r.provider);
+    // Quoten: gültige Live-Snapshots je Markt für anstehende Spiele (Mock nie als Live-Quote im Live-Modus)
+    const byMarket = Object.fromEntries(MARKETS.map(m => [m, up.length ? db.get<{ n: number }>(`SELECT COUNT(DISTINCT s.event_id) AS n FROM odds_snapshots s WHERE s.event_id IN (${up.map(() => '?').join(',')})
+        AND s.market_id = ? AND s.snapshot_kind = 'live' AND s.validation_errors = '[]' ${m === 'OU' ? 'AND s.line = 2.5' : ''}`, ...up.map(e => e.id), m)!.n : 0])) as Record<MarketId, number>;
+    const withOdds = up.length ? db.get<{ n: number; t: string | null }>(`SELECT COUNT(DISTINCT s.event_id) AS n, MAX(s.retrieved_at) AS t FROM odds_snapshots s WHERE s.event_id IN (${up.map(() => '?').join(',')}) AND s.snapshot_kind = 'live' AND s.validation_errors = '[]'`, ...up.map(e => e.id))! : { n: 0, t: null };
+    // Teams: Historie je Team im SELBEN Wettbewerb; nicht verknüpfte Teams aus missing_data
+    const games = (team: number) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE competition_id = ? AND status = 'finished' AND home_goals IS NOT NULL AND (home_team_id = ? OR away_team_id = ?)", c.id, team, team)!.n;
+    const teamIds = new Map<number, string>(); for (const e of up) { teamIds.set(e.home_team_id, e.home); teamIds.set(e.away_team_id, e.away); }
+    const withoutHistory = [...teamIds].filter(([id]) => games(id) < MIN_TEAM_GAMES).map(([, n]) => n);
+    const unlinked = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM missing_data WHERE kind = 'unlinked_team' AND detail LIKE ?", `%(Wettbewerb ${c.id})%`)!.n;
+    const names = db.all<{ name: string }>('SELECT DISTINCT t.name FROM teams t JOIN events e ON e.home_team_id = t.id OR e.away_team_id = t.id WHERE e.competition_id = ?', c.id).map(r => r.name);
+    let dupes = 0; for (let i = 0; i < names.length && names.length < 200; i++) for (let j = i + 1; j < names.length; j++) if (linkSimilarity(names[i], names[j]) >= 0.85) dupes++;
+    // Modelle: genau die Voraussetzungen der Prognose (Ligahistorie, Teamhistorie im selben Wettbewerb)
+    const eventsComputable = up.filter(e => games(e.home_team_id) >= MIN_TEAM_GAMES && games(e.away_team_id) >= MIN_TEAM_GAMES).length;
+    const computable = fin.n >= MIN_LEAGUE_HISTORY && (up.length ? eventsComputable > 0 : true);
+    const modelReason = fin.n === 0 ? 'keine Historie für diesen Wettbewerb' : fin.n < MIN_LEAGUE_HISTORY ? `nur ${fin.n} Spiele Historie (mindestens ${MIN_LEAGUE_HISTORY})`
+      : up.length && !eventsComputable ? `keine anstehende Partie mit ≥ ${MIN_TEAM_GAMES} Spielen Teamhistorie je Team` : null;
+    // Validierung je Markt: jüngster Scope-Eintrag dieses Wettbewerbs
+    const validation = Object.fromEntries(MARKETS.map(m => {
+      const v = db.get<{ status: 'VALIDATED' | 'UNVALIDATED' | 'FAILED'; market_evidence: string; model_version_id: string }>(
+        'SELECT status, market_evidence, model_version_id FROM model_scope_validations WHERE competition_id = ? AND market_id = ? ORDER BY id DESC LIMIT 1', c.id, m);
+      return [m, v ? { status: v.status, marketEvidence: v.market_evidence, modelVersion: v.model_version_id } : { status: 'UNVALIDATED' as const, marketEvidence: null, modelVersion: null }];
+    })) as CompetitionCoverage['validation'];
+    const explanation: string[] = [];
+    if (c.is_mock) explanation.push('MOCK-Daten: fiktiv, nur Entwicklungsmodus.');
+    if (!up.length) explanation.push('Keine anstehenden Spiele im Analysefenster.');
+    if (up.length && !withOdds.n) explanation.push('Keine gültigen Live-Quoten für anstehende Spiele.');
+    if (!computable) {
+      if (isIntlClubCup(c.name, sportKey) && fin.n < MIN_LEAGUE_HISTORY) explanation.push(`${c.name}: keine geeignete Historie dieses Wettbewerbs vorhanden (football-data.co.uk bietet dafür keine CSV). Die Teams spielen in unterschiedlichen nationalen Ligen; deren Modelle werden nicht ungeprüft übertragen. Es werden deshalb keine Wahrscheinlichkeiten berechnet.`);
+      else explanation.push(`Modelle nicht berechenbar: ${modelReason}.`);
+    }
+    if (withoutHistory.length && computable) explanation.push(`${withoutHistory.length} Teams ohne ausreichende Historie in diesem Wettbewerb (z. B. Aufsteiger oder nicht zugeordnete Namen).`);
+    if (unlinked) explanation.push(`${unlinked} Teamnamen konnten nicht eindeutig zugeordnet werden (Admin → Missing Data).`);
+    if (MARKETS.every(m => validation[m].status !== 'VALIDATED')) explanation.push('Kein Markt dieses Wettbewerbs ist validiert: Signale sind experimentell.');
+    else if (MARKETS.some(m => validation[m].status === 'VALIDATED' && validation[m].marketEvidence !== 'BETTER')) explanation.push('Validiert heißt hier: besser als die Basisrate und kalibriert. Ein Mehrwert gegenüber dem Markt ist nur bei „BETTER“ belegt.');
+    if (!byMarket.BTTS && up.length) explanation.push('BTTS: keine Quoten (Event-Odds optional und budgetbegrenzt).');
+    const status: CoverageStatus = !computable ? 'INSUFFICIENT DATA' : !up.length ? 'NO FIXTURES' : withOdds.n && eventsComputable === up.length && !unlinked ? 'READY' : 'PARTIAL';
+    out.push({
+      competitionId: c.id, name: c.name, providers: [...new Set(aliases.map(a => a.provider))], sportKey, isMock: !!c.is_mock,
+      fixtures: { available: up.length > 0, upcoming: up.length, nextKickoff: up[0]?.kickoff_utc ?? null },
+      odds: { available: withOdds.n > 0, eventsWithOdds: withOdds.n, byMarket, newestRetrievedAt: withOdds.t },
+      history: { available: fin.n >= MIN_LEAGUE_HISTORY, finishedMatches: fin.n, seasons: fin.seasons, sources: histSources },
+      teams: { unique: !unlinked && !dupes && !withoutHistory.length, upcomingTeams: teamIds.size, withoutHistory: withoutHistory.slice(0, 20), unlinked, possibleDuplicates: dupes },
+      models: { computable, eventsComputable, eventsTotal: up.length, reason: modelReason },
+      validation, status, explanation,
+    });
+  }
+  // Konfigurierte Sport-Keys ohne bisher bekannten Wettbewerb (z. B. noch keine Spielsuche gelaufen)
+  if (live) for (const k of effectiveSportKeys(cfg)) {
+    if (out.some(o => o.sportKey === k)) continue;
+    const ucl = isIntlClubCup('', k);
+    out.push({ competitionId: null, name: k, providers: ['theoddsapi'], sportKey: k, isMock: false,
+      fixtures: { available: false, upcoming: 0, nextKickoff: null }, odds: { available: false, eventsWithOdds: 0, byMarket: { '1X2': 0, OU: 0, BTTS: 0 }, newestRetrievedAt: null },
+      history: { available: false, finishedMatches: 0, seasons: 0, sources: [] }, teams: { unique: false, upcomingTeams: 0, withoutHistory: [], unlinked: 0, possibleDuplicates: 0 },
+      models: { computable: false, eventsComputable: 0, eventsTotal: 0, reason: 'keine Historie für diesen Wettbewerb' },
+      validation: { '1X2': { status: 'UNVALIDATED', marketEvidence: null, modelVersion: null }, OU: { status: 'UNVALIDATED', marketEvidence: null, modelVersion: null }, BTTS: { status: 'UNVALIDATED', marketEvidence: null, modelVersion: null } },
+      status: 'INSUFFICIENT DATA',
+      explanation: ['Noch keine Spiele abgerufen (kostenlose Spielsuche ausführen).', ucl ? 'Für diesen Wettbewerb ist keine geeignete Historie vorhanden; Modelle nationaler Ligen werden nicht übertragen. Es werden keine Wahrscheinlichkeiten berechnet.' : 'Historie über CSV-Import (football-data.co.uk) nötig.'] });
+  }
+  return { generatedAt: t, competitions: out, notes: [
+    'Alle Angaben aus der Datenbank. Validiert = im Holdout besser als die Basisrate und kalibriert (je Markt); das ist kein Gewinnnachweis.',
+    'Prognosen nutzen ausschließlich die Historie desselben (verknüpften) Wettbewerbs.',
+  ] };
+}
diff --git a/backend/src/engines/discovery.ts b/backend/src/engines/discovery.ts
index 28cbed1..bc727fe 100644
--- a/backend/src/engines/discovery.ts
+++ b/backend/src/engines/discovery.ts
@@ -147,7 +147,6 @@ export class SyncService {
 
     // 8 Prognosen und Value
     const settings = sys;
-    const mv = this.pred.currentModelVersion();
     const changes: { prev: StoredSignal | null; next: StoredSignal }[] = [];
     for (const p of prioritized) {
       try {
@@ -155,12 +154,14 @@ export class SyncService {
         if (!pr) continue;
         sum.predictions++;
         const ev = this.repo.event(p.id)!;
+        const mv = this.pred.currentModelVersion(ev.competition_id);
         const sigs = this.value.evaluate(pr, {
           minEv: settings.min_ev ?? this.cfg.analysis.minEv, strategy: (settings.strategy as Config['analysis']['strategy']) ?? this.cfg.analysis.strategy,
           oddsMaxAgeMinutes: this.cfg.analysis.oddsMaxAgeMinutes, preferredBookmakers: json.parse<string[]>(settings.preferred_bookmakers, []),
-          modelValidated: mv.status === 'VALIDATED', isMock: !!ev.is_mock,
-          // Reihenfolge: manuell gesetztes Gewicht > im Backtest validiertes Gewicht > Default je Risikoprofil
-          modelWeight: settings.model_weight ?? (mv.status === 'VALIDATED' ? ((mv.weights as Record<string, unknown> | null)?.blendWeight as number | undefined) ?? null : null),
+          // v0.4.0: Validierung je Wettbewerb × Markt (nie die neueste global validierte Version für ungeprüfte Wettbewerbe)
+          modelValidated: mv.validatedMarkets.length > 0, validatedMarkets: mv.validatedMarkets, marketEdgeMarkets: mv.marketEdgeMarkets, isMock: !!ev.is_mock,
+          // Reihenfolge: manuell gesetztes Gewicht > im Backtest für diesen Markt validiertes Gewicht > Default je Risikoprofil
+          modelWeight: settings.model_weight ?? null, modelWeightByMarket: settings.model_weight != null ? undefined : mv.blendWeightByMarket,
         }, now);
         for (const s of sigs) sum.signals[s.status] = (sum.signals[s.status] ?? 0) + 1;
         changes.push(...this.value.persist(sigs, now));
@@ -182,6 +183,33 @@ export class SyncService {
     return sum;
   }
 
+  /**
+   * v0.4.0: reine Spielsuche (Discovery) ohne kostenpflichtige Abrufe – eigener Scheduler-Job mit eigenem Intervall.
+   * The Odds API: nur GET /v4/sports und /v4/sports/{sport}/events (laut offizieller V4-Doku kostenlos).
+   * Keine Quoten, keine Ergebnisse (/scores kostet Credits), keine Prognosen.
+   */
+  async discover(now: Date = new Date()): Promise<{ fixturesFound: number; newEvents: number; startedExcluded: number; errors: string[]; window: { from: string; to: string } }> {
+    const from = addMinutes(now, 5), to = addHours(now, this.cfg.analysis.horizonHours);
+    const out = { fixturesFound: 0, newEvents: 0, startedExcluded: 0, errors: [] as string[], window: { from: from.toISOString(), to: to.toISOString() } };
+    for (const op of this.providers.odds) op.setNow?.(now);
+    for (const p of this.providers.fixtures) {
+      try {
+        const fx = await p.upcomingFixtures(from, to);
+        out.fixturesFound += fx.length;
+        for (const f of fx) {
+          if (!(Date.parse(f.kickoffUtc) > now.getTime()) && f.status === 'scheduled') { out.startedExcluded++; continue; }
+          const known = this.match.existing(f.provider, f.providerEventId);
+          this.match.upsertFixture(f);
+          if (!known) out.newEvents++;
+        }
+      } catch (e) {
+        out.errors.push(`discover.${p.name}: ${(e as Error).message}`);
+        if (!(e instanceof QuotaExhaustedError) && !(e instanceof ProviderBlockedError)) logError(this.db, `discover.${p.name}`, e);
+      }
+    }
+    return out;
+  }
+
   systemSettings() {
     return this.db.get<{ min_ev: number; strategy: string; preferred_bookmakers: string; model_weight: number | null; enabled_competitions: string; max_fixtures_per_run: number }>(
       'SELECT min_ev, strategy, preferred_bookmakers, model_weight, enabled_competitions, max_fixtures_per_run FROM system_settings WHERE id = 1')!;
@@ -221,12 +249,27 @@ export class SyncService {
   }
 
   private async refreshResults(now: Date): Promise<void> {
-    const stale = this.db.all<{ id: number }>(`SELECT id FROM events WHERE status IN ('scheduled','live','unknown') AND kickoff_utc < ? ORDER BY kickoff_utc DESC LIMIT 30`, addHours(now, -2).toISOString());
+    const stale = this.db.all<{ id: number; competition_id: number; kickoff_utc: string }>(`SELECT id, competition_id, kickoff_utc FROM events WHERE status IN ('scheduled','live','unknown') AND kickoff_utc < ? ORDER BY kickoff_utc DESC LIMIT 30`, addHours(now, -2).toISOString());
+    // v0.4.0: Provider mit gebündeltem Ergebnisabruf (The Odds API): ein Abruf je Wettbewerb statt je Spiel
+    const done = new Set<number>();
+    for (const p of this.providers.fixtures) {
+      if (!p.resultsFor) continue;
+      const items = stale.flatMap(e => this.db.all<{ provider_event_id: string }>('SELECT provider_event_id FROM event_mappings WHERE event_id = ? AND provider = ?', e.id, p.name).map(m => ({
+        eventId: e.id, providerEventId: m.provider_event_id, kickoffUtc: e.kickoff_utc,
+        competitionProviderId: this.db.get<{ provider_id: string }>('SELECT provider_id FROM competition_aliases WHERE competition_id = ? AND provider = ? LIMIT 1', e.competition_id, p.name)?.provider_id ?? null })));
+      if (!items.length) continue;
+      for (const f of await p.resultsFor(items)) {
+        const it = items.find(i => i.providerEventId === f.providerEventId);
+        this.match.upsertFixture(f);
+        if (it && f.status === 'finished') done.add(it.eventId);
+      }
+    }
     for (const e of stale) {
+      if (done.has(e.id)) continue;
       const maps = this.db.all<{ provider: string; provider_event_id: string }>('SELECT provider, provider_event_id FROM event_mappings WHERE event_id = ?', e.id);
       for (const m of maps) {
         const p = this.providerFor(m.provider);
-        if (!p?.matchDetails) continue;
+        if (!p?.matchDetails || p.resultsFor) continue;
         const f = await p.matchDetails(m.provider_event_id);
         if (f) { this.match.upsertFixture(f); break; }
       }
diff --git a/backend/src/engines/oddsApiStatus.ts b/backend/src/engines/oddsApiStatus.ts
index b54d0d7..263609e 100644
--- a/backend/src/engines/oddsApiStatus.ts
+++ b/backend/src/engines/oddsApiStatus.ts
@@ -142,9 +142,11 @@ export function estimateRunCost(app: App): { credits: number | null; detail: str
   if (!keys.length) return { credits: null, detail: 'THE_ODDS_API_SPORT_KEYS leer: alle aktiven Fußball-Wettbewerbe würden abgefragt (Kosten unbekannt, je Wettbewerb ' + markets * regions + ' Credits).' };
   const odds = keys.length * markets * regions;
   const btts = c.includeBtts ? c.bttsMaxEventsPerRun * regions : 0;
-  const stale = app.db.get<{ n: number }>(`SELECT COUNT(DISTINCT e.id) AS n FROM events e JOIN event_mappings m ON m.event_id = e.id AND m.provider = ?
-      WHERE e.status IN ('scheduled','live','unknown') AND e.kickoff_utc < ?`, ODDS_PROVIDER, new Date(Date.now() - 2 * 3_600_000).toISOString())!.n;
-  const scores = c.resultsEnabled && stale > 0 ? keys.length * 2 : 0;
+  // v0.4.0: Ergebnisse gebündelt – 2 Credits je Wettbewerb mit offenen Spielen der letzten 3 Tage
+  const staleSports = app.db.get<{ n: number }>(`SELECT COUNT(DISTINCT ca.provider_id) AS n FROM events e JOIN event_mappings m ON m.event_id = e.id AND m.provider = ?
+      JOIN competition_aliases ca ON ca.competition_id = e.competition_id AND ca.provider = ?
+      WHERE e.status IN ('scheduled','live','unknown') AND e.kickoff_utc < ? AND e.kickoff_utc > ?`, ODDS_PROVIDER, ODDS_PROVIDER, new Date(Date.now() - 2 * 3_600_000).toISOString(), new Date(Date.now() - 3 * 86_400_000).toISOString())!.n;
+  const scores = c.resultsEnabled ? Math.min(keys.length, staleSports) * 2 : 0;
   return { credits: odds + btts + scores, detail: `${keys.length} Wettbewerb(e) × ${markets} Märkte (${ODDS_MARKETS}) × ${regions} Region(en) = ${odds}` + (btts ? ` + BTTS bis ${btts}` : '') + (scores ? ` + Ergebnisse ${scores}` : '') };
 }
 
@@ -175,10 +177,26 @@ export interface OddsApiStatusReport {
   errors: { at: string; endpoint: string; status: number; note: string | null }[];
   lastError: { at: string | null; message: string | null };
   data: { events: number; upcomingEvents: number; bookmakers: number; markets: string[]; validSnapshots: number; newestRetrievedAt: string | null; ageMinutes: number | null };
+  /**
+   * v0.4.0: Was ist tatsächlich belegt? Getrennt nach Verbindung (kostenlos), Spielsuche (kostenlos), Quoten (kostenpflichtig)
+   * und Prognosen auf Basis echter Quoten. Ein bestandener Verbindungstest belegt NICHT, dass Quoten oder Prognosen funktionieren.
+   */
+  verification: {
+    connection: { verified: boolean; at: string | null; note: string };
+    discovery: { verified: boolean; at: string | null; httpStatus: number | null; note: string };
+    odds: { verified: boolean; at: string | null; httpStatus: number | null; note: string };
+    predictions: { verified: boolean; count: number; at: string | null; note: string };
+  };
+  /** Letzter echter (nicht gecachter) Abruf: Endpunkt und HTTP-Status */
+  lastHttp: { at: string; endpoint: string; status: number; costCredits: number } | null;
+  /** Nächste geplante Läufe laut Scheduler (null = Scheduler aus) */
+  schedule: { discovery: { intervalMin: number; nextDue: string | null; lastSuccess: string | null } | null; odds: { intervalMin: number; nextDue: string | null; lastSuccess: string | null } | null } | null;
 }
 
+type SchedStatus = { name: string; intervalMin: number; nextDue: string; lastSuccess: string | null }[];
+
 /** Status für Admin und Diagnose. Ausschließlich aus Konfiguration und Datenbank, nichts erfunden. */
-export function oddsApiStatus(app: App, now: Date = new Date()): OddsApiStatusReport {
+export function oddsApiStatus(app: App, now: Date = new Date(), sched?: SchedStatus): OddsApiStatusReport {
   const cfg = app.cfg, db = app.db;
   const isMock = cfg.dataMode === 'mock' || app.providers.isMock;
   const last = lastConnectionTest(app), lastOk = lastConnectionTest(app, true);
@@ -222,6 +240,24 @@ export function oddsApiStatus(app: App, now: Date = new Date()): OddsApiStatusRe
     if (lastPaidErr && lastPaidErr.at > last!.testedAt) degrade(`Letzter Quotenabruf fehlerhaft: HTTP ${lastPaidErr.status} (${lastPaidErr.endpoint}).`);
     if (lastAnyOk && Date.parse(lastAnyOk) < now.getTime() - CONFIRM_MAX_AGE_H * 3_600_000) degrade(`Seit über ${CONFIRM_MAX_AGE_H} h kein erfolgreicher Abruf: Verbindungstest wiederholen.`);
   }
+  // v0.4.0: Belege getrennt ausweisen
+  const lastOkOf = (re: string) => db.get<{ created_at: string; status: number } | undefined>(`SELECT created_at, status FROM api_requests WHERE provider = ? AND from_cache = 0 AND status BETWEEN 200 AND 299 AND ${re} ORDER BY id DESC LIMIT 1`, ODDS_PROVIDER) ?? null;
+  const disc = lastOkOf("endpoint LIKE '/v4/sports/%/events'");
+  const oddsOk = lastOkOf("endpoint LIKE '/v4/sports/%/odds' AND endpoint NOT LIKE '%/events/%'");
+  const pred = db.get<{ n: number; t: string | null }>(`SELECT COUNT(DISTINCT p.id) AS n, MAX(p.created_at) AS t FROM predictions p JOIN events e ON e.id = p.event_id AND e.is_mock = 0
+      JOIN event_mappings m ON m.event_id = e.id AND m.provider = ? WHERE EXISTS (SELECT 1 FROM value_signals v JOIN odds_snapshots s ON s.id = v.best_snapshot_id
+        WHERE v.prediction_id = p.id AND s.provider = ? AND s.snapshot_kind = 'live')`, ODDS_PROVIDER, ODDS_PROVIDER)!;
+  const lastHttpRow = db.get<{ created_at: string; endpoint: string; status: number; cost: number }>('SELECT created_at, endpoint, status, cost FROM api_requests WHERE provider = ? AND from_cache = 0 ORDER BY id DESC LIMIT 1', ODDS_PROVIDER);
+  const oddsVerified = !isMock && !!oddsOk && snap.n > 0;
+  const verification: OddsApiStatusReport['verification'] = {
+    connection: { verified: !isMock && !!lastOk, at: lastOk?.testedAt ?? null, note: 'Kostenloser Test GET /v4/sports: belegt nur Erreichbarkeit und gültigen Schlüssel – KEINE Quoten, KEINE Prognosen.' },
+    discovery: { verified: !isMock && !!disc, at: disc?.created_at ?? null, httpStatus: disc?.status ?? null, note: 'Kostenlose Spielsuche GET /v4/sports/{sport}/events: belegt Spielplan, keine Quoten.' },
+    odds: { verified: oddsVerified, at: oddsOk?.created_at ?? null, httpStatus: oddsOk?.status ?? null,
+      note: oddsVerified ? `Kostenpflichtiger Quotenabruf erfolgreich; ${snap.n} gültige Live-Snapshots gespeichert.` : 'Noch kein erfolgreicher kostenpflichtiger Quotenabruf mit gültigen Quoten (NOT VERIFIED).' },
+    predictions: { verified: !isMock && pred.n > 0, count: pred.n, at: pred.t,
+      note: pred.n > 0 ? 'Prognosen mit Value-Bewertung auf Basis echter The-Odds-API-Quoten vorhanden (ohne Validierungsnachweis des Modells).' : 'Keine Prognose auf Basis echter Quoten (NOT VERIFIED). Ohne Historie (CSV-Import) ist keine Prognose möglich.' },
+  };
+  const js = (n: string) => { const j = sched?.find(x => x.name === n); return j ? { intervalMin: j.intervalMin, nextDue: j.nextDue === 'sofort' ? nowIso(now) : j.nextDue, lastSuccess: j.lastSuccess } : null; };
   const paidReason = app.requireOddsConnectionTest ? paidGateReason(app) : null;
   const est = estimateRunCost(app);
   return {
@@ -238,5 +274,7 @@ export function oddsApiStatus(app: App, now: Date = new Date()): OddsApiStatusRe
     },
     errors, lastError: { at: h?.last_error_at ?? null, message: h?.last_error ?? null },
     data: { events: ev.n, upcomingEvents: ev.up, bookmakers: snap.books, markets, validSnapshots: snap.n, newestRetrievedAt: snap.newest, ageMinutes: snap.newest ? Math.round((now.getTime() - Date.parse(snap.newest)) / 60_000) : null },
+    verification, lastHttp: lastHttpRow ? { at: lastHttpRow.created_at, endpoint: lastHttpRow.endpoint, status: lastHttpRow.status, costCredits: lastHttpRow.cost } : null,
+    schedule: sched ? { discovery: js('discovery'), odds: js('hourly_sync') } : null,
   };
 }
diff --git a/backend/src/engines/prediction/index.ts b/backend/src/engines/prediction/index.ts
index c9b66f7..27b03ea 100644
--- a/backend/src/engines/prediction/index.ts
+++ b/backend/src/engines/prediction/index.ts
@@ -10,6 +10,7 @@ import { countTeamGames } from './history.js';
 import { buildElo, dixonColes, elo, featureModel, fitDixonColes, fitFeatureModel, poissonStrength, type DcFit, type EloState, type FeatureFit, type ModelOutput } from './models.js';
 import { combine, type EnsembleResult, type Weights } from './ensemble.js';
 import { nowIso, sha, stableStringify } from '../../util/core.js';
+import type { MarketId } from '../../providers/types.js';
 
 export const MODEL_VERSION_BASE = 'ensemble-1.0.0';
 
@@ -20,25 +21,88 @@ export interface PredictionRecord {
   ensemble: EnsembleResult; components: ModelOutput[]; dataQuality: DataQuality;
 }
 
+export interface ModelVersionForScope {
+  id: string; weights: Weights | null; status: 'VALIDATED' | 'UNVALIDATED';
+  /** Märkte, die für diesen Wettbewerb validiert sind */
+  validatedMarkets: MarketId[];
+  /** Märkte mit statistisch belegtem Mehrwert gegenüber dem Markt */
+  marketEdgeMarkets: MarketId[];
+  blendWeightByMarket: Partial<Record<MarketId, number>>;
+}
+
 interface LeagueFits { key: string; hist: HistMatch[]; dc: DcFit | null; elo: EloState; feat: FeatureFit | null }
 
+/**
+ * Datenqualität eines Spiels – reine Funktion, damit Live-Prognose und Backtest dieselbe Regel verwenden (v0.4.0).
+ * Im Backtest sind historische Aufstellungen unbekannt: dort immer lineups = 'none' (konservativ).
+ */
+export function computeDataQuality(hist: HistMatch[], home: number, away: number, before: string, outputs: ModelOutput[], lineups: 'confirmed' | 'expected' | 'none'): DataQuality {
+  const issues: string[] = [];
+  const hg = countTeamGames(hist, home, before), ag = countTeamGames(hist, away, before);
+  const recent = hist.filter(m => (m.home === home || m.away === home || m.home === away || m.away === away)).slice(-16);
+  const xgCoverage = recent.length ? recent.filter(m => m.xgH != null).length / recent.length : 0;
+  let score = 0;
+  score += Math.min(30, Math.min(hg, ag) * 1.5);              // Teamhistorie bis 20 Spiele
+  score += Math.min(20, hist.length / 15);                     // Ligadatenbasis bis 300 Spiele
+  score += outputs.filter(o => o.available).length * 7.5;      // verfügbare Modelle (max 30)
+  score += lineups === 'confirmed' ? 10 : lineups === 'expected' ? 5 : 0;
+  score += xgCoverage * 10;
+  if (Math.min(hg, ag) < 6) issues.push(`zu wenig Teamhistorie (Heim ${hg}, Gast ${ag} Spiele)`);
+  if (!hist.length) issues.push('keine Historie für diesen Wettbewerb: keine Wahrscheinlichkeiten (Modelle anderer Wettbewerbe werden nicht übertragen)');
+  else if (hist.length < 80) issues.push(`kleine Ligadatenbasis (${hist.length} Spiele)`);
+  if (lineups === 'none') issues.push('keine Aufstellungen');
+  if (xgCoverage === 0) issues.push('keine xG-Daten');
+  for (const o of outputs) if (!o.available) issues.push(`${o.model}: ${o.reason}`);
+  issues.push('Verletzungen/Sperren: keine Datenquelle angebunden');
+  const status = Math.min(hg, ag) < 6 || !outputs.some(o => o.available) ? 'insufficient' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
+  return { score: Math.round(score), status, issues, homeGames: hg, awayGames: ag, leagueGames: hist.length, lineups, xgCoverage };
+}
+
+/** Inhalts-Hash der Historie (alle Felder, die in die Modelle eingehen). */
+export function histHash(hist: HistMatch[]): string {
+  return sha(hist.map(m => `${m.eventId}|${m.kickoff}|${m.home}|${m.away}|${m.hg}|${m.ag}|${m.neutral ? 1 : 0}|${m.xgH ?? ''}|${m.xgA ?? ''}`).join(';'), 20);
+}
+
 export class PredictionEngine {
   private repo: Repository;
   private fits = new Map<number, LeagueFits>();
   constructor(private db: Db) { this.repo = new Repository(db); }
 
-  currentModelVersion(): { id: string; weights: Weights | null; status: string } {
-    const r = this.db.get<{ id: string; weights: string | null; validation_status: string }>("SELECT id, weights, validation_status FROM model_versions WHERE validation_status = 'VALIDATED' ORDER BY created_at DESC LIMIT 1");
-    if (r) return { id: r.id, weights: json.parse<Weights | null>(r.weights, null), status: r.validation_status };
+  /**
+   * Modellversion für einen Wettbewerb (v0.4.0).
+   * Vorher: neueste GLOBAL validierte Version für alle Wettbewerbe. Jetzt: nur eine Version mit VALIDATED-Eintrag für genau
+   * diesen Wettbewerb (model_scope_validations); Gewichte nur für die dort validierten Märkte. Sonst Basisversion UNVALIDATED.
+   * Versionen ohne Scope-Einträge (vor v0.4.0) werden live nicht mehr als validiert verwendet – Validierung neu ausführen.
+   */
+  currentModelVersion(competitionId?: number): ModelVersionForScope {
+    if (competitionId != null) {
+      const v = this.db.get<{ id: string; weights: string | null }>(`SELECT mv.id, mv.weights FROM model_scope_validations s JOIN model_versions mv ON mv.id = s.model_version_id
+          WHERE s.competition_id = ? AND s.status = 'VALIDATED' ORDER BY mv.created_at DESC, s.id DESC LIMIT 1`, competitionId);
+      if (v) {
+        const scopes = this.db.all<{ market_id: MarketId; status: string; market_evidence: string; blend_weight: number | null }>(
+          'SELECT market_id, status, market_evidence, blend_weight FROM model_scope_validations WHERE model_version_id = ? AND competition_id = ?', v.id, competitionId);
+        const ok = scopes.filter(x => x.status === 'VALIDATED');
+        const all = json.parse<Record<string, unknown> | null>(v.weights, null) ?? {};
+        const weights: Weights = {};
+        for (const x of ok) if (all[x.market_id]) weights[x.market_id] = all[x.market_id] as Record<string, number>;
+        return { id: v.id, weights, status: 'VALIDATED', validatedMarkets: ok.map(x => x.market_id), marketEdgeMarkets: ok.filter(x => x.market_evidence === 'BETTER').map(x => x.market_id),
+          blendWeightByMarket: Object.fromEntries(ok.filter(x => x.blend_weight != null).map(x => [x.market_id, x.blend_weight!])) };
+      }
+    }
     this.db.run(`INSERT OR IGNORE INTO model_versions (id, description, weights, validation_status) VALUES (?, ?, NULL, 'UNVALIDATED')`,
       MODEL_VERSION_BASE, 'Gleichgewichtetes Ensemble aus Poisson, Dixon-Coles, Elo und Merkmalsmodell (nicht validiert)');
-    return { id: MODEL_VERSION_BASE, weights: null, status: 'UNVALIDATED' };
+    return { id: MODEL_VERSION_BASE, weights: null, status: 'UNVALIDATED', validatedMarkets: [], marketEdgeMarkets: [], blendWeightByMarket: {} };
   }
 
-  /** Liga-Fits einmal pro Datenstand berechnen (Cache-Schlüssel = Anzahl + letztes Spiel). */
+  /**
+   * Liga-Fits einmal pro Datenstand berechnen.
+   * v0.4.0: Cache-Schlüssel = Inhalts-Hash ALLER Modelleingaben (Spiel, Anstoß, Teams, Tore, neutraler Platz, xG) + Stunde.
+   * Vorher nur Anzahl + letzte Event-ID + Stunde: korrigierte Ergebnisse oder xG-Werte wurden innerhalb derselben Stunde
+   * nicht berücksichtigt und die gespeicherte Prognose wich von der zurückgegebenen ab (Regressionstest v040_p1).
+   */
   leagueFits(competitionId: number, before: string): LeagueFits {
     const hist = this.repo.competitionHistory(competitionId, before);
-    const key = `${hist.length}:${hist[hist.length - 1]?.eventId ?? 0}:${before.slice(0, 13)}`;
+    const key = `${hist.length}:${histHash(hist)}:${before.slice(0, 13)}`;
     const c = this.fits.get(competitionId);
     if (c && c.key === key) return c;
     const f: LeagueFits = { key, hist, dc: fitDixonColes(hist, before), elo: buildElo(hist, before), feat: fitFeatureModel(hist, before) };
@@ -47,25 +111,7 @@ export class PredictionEngine {
   }
 
   dataQuality(eventId: number, hist: HistMatch[], home: number, away: number, before: string, outputs: ModelOutput[]): DataQuality {
-    const issues: string[] = [];
-    const hg = countTeamGames(hist, home, before), ag = countTeamGames(hist, away, before);
-    const lineups = this.repo.lineupStatus(eventId);
-    const recent = hist.filter(m => (m.home === home || m.away === home || m.home === away || m.away === away)).slice(-16);
-    const xgCoverage = recent.length ? recent.filter(m => m.xgH != null).length / recent.length : 0;
-    let score = 0;
-    score += Math.min(30, Math.min(hg, ag) * 1.5);              // Teamhistorie bis 20 Spiele
-    score += Math.min(20, hist.length / 15);                     // Ligadatenbasis bis 300 Spiele
-    score += outputs.filter(o => o.available).length * 7.5;      // verfügbare Modelle (max 30)
-    score += lineups === 'confirmed' ? 10 : lineups === 'expected' ? 5 : 0;
-    score += xgCoverage * 10;
-    if (Math.min(hg, ag) < 6) issues.push(`zu wenig Teamhistorie (Heim ${hg}, Gast ${ag} Spiele)`);
-    if (hist.length < 80) issues.push(`kleine Ligadatenbasis (${hist.length} Spiele)`);
-    if (lineups === 'none') issues.push('keine Aufstellungen');
-    if (xgCoverage === 0) issues.push('keine xG-Daten');
-    for (const o of outputs) if (!o.available) issues.push(`${o.model}: ${o.reason}`);
-    issues.push('Verletzungen/Sperren: keine Datenquelle angebunden');
-    const status = Math.min(hg, ag) < 6 || !outputs.some(o => o.available) ? 'insufficient' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
-    return { score: Math.round(score), status, issues, homeGames: hg, awayGames: ag, leagueGames: hist.length, lineups, xgCoverage };
+    return computeDataQuality(hist, home, away, before, outputs, this.repo.lineupStatus(eventId));
   }
 
   predictEvent(eventId: number, at: Date = new Date()): PredictionRecord | null {
@@ -80,10 +126,12 @@ export class PredictionEngine {
       elo(lf.elo, ev.home_team_id, ev.away_team_id, neutral),
       featureModel(lf.feat, lf.hist, ev.home_team_id, ev.away_team_id, before, neutral),
     ];
-    const mv = this.currentModelVersion();
+    const mv = this.currentModelVersion(ev.competition_id);
     const dq = this.dataQuality(eventId, lf.hist, ev.home_team_id, ev.away_team_id, before, outputs);
     const ens = combine(outputs, mv.weights, Math.min(dq.homeGames, dq.awayGames));
-    const inputsHash = sha(stableStringify({ mv: mv.id, lf: lf.key, ev: [ev.home_team_id, ev.away_team_id, ev.kickoff_utc], lu: dq.lineups }), 24);
+    // v0.4.0: zusätzlich Gewichte und das Ergebnis selbst – gespeicherte und zurückgegebene Prognose sind damit immer identisch
+    const inputsHash = sha(stableStringify({ mv: mv.id, w: mv.weights, lf: lf.key, ev: [ev.home_team_id, ev.away_team_id, ev.kickoff_utc, neutral], lu: dq.lineups,
+      out: { p: ens.probs, sd: ens.sd, lh: ens.lambdaHome, la: ens.lambdaAway }, dq: [dq.score, dq.status] }), 24);
     const existing = this.db.get<{ id: number; created_at: string }>('SELECT id, created_at FROM predictions WHERE event_id = ? AND inputs_hash = ?', eventId, inputsHash);
     const createdAt = existing?.created_at ?? nowIso(at);
     const id = existing?.id ?? this.db.run(
diff --git a/backend/src/engines/recommendation.ts b/backend/src/engines/recommendation.ts
index c19c6e1..66c0b12 100644
--- a/backend/src/engines/recommendation.ts
+++ b/backend/src/engines/recommendation.ts
@@ -41,15 +41,31 @@ const SIGNAL_SQL = `SELECT s.*, th.name AS home, ta.name AS away, c.name AS comp
   FROM value_signals s JOIN events e ON e.id = s.event_id JOIN teams th ON th.id = e.home_team_id JOIN teams ta ON ta.id = e.away_team_id
   JOIN competitions c ON c.id = e.competition_id LEFT JOIN bookmakers b ON b.id = s.best_bookmaker_id`;
 
+/** Robuster Rangwert: EV an der Untergrenze × Qualität (gleich für Live-Bericht und Backtest). */
+export function rankScore(s: { ev_low: number | null; quality_score: number }): number {
+  return Math.max(0, s.ev_low ?? 0) * (s.quality_score / 100) + (s.quality_score / 100) * 0.001;
+}
+
+/**
+ * v0.4.0: gemeinsame Auswahlregel für Live-Bericht und Backtest-Simulation.
+ * Höchstens eine Auswahl je Spiel (weitere gelten als korreliert), danach Rangfolge nach rankScore, höchstens `max`.
+ * Gleichstand: stabile Reihenfolge nach id (deterministisch).
+ */
+export function selectTop<T extends { id: number; event_id: number; ev_low: number | null; quality_score: number }>(cands: T[], max: number): { pick: T; correlated: T[] }[] {
+  const byEvent = new Map<number, T[]>();
+  for (const c of cands) byEvent.set(c.event_id, [...(byEvent.get(c.event_id) ?? []), c]);
+  const cmp = (a: T, b: T) => rankScore(b) - rankScore(a) || a.id - b.id;
+  const picks = [...byEvent.values()].map(list => { const s = [...list].sort(cmp); return { pick: s[0], correlated: s.slice(1) }; });
+  return picks.sort((a, b) => cmp(a.pick, b.pick)).slice(0, Math.max(0, max));
+}
+
 export class RecommendationEngine {
   private odds: OddsStore;
   constructor(private db: Db, private opts: LifecycleOptions = {}) { this.odds = new OddsStore(db); }
 
   private minEv(): number { return this.db.get<{ min_ev: number }>('SELECT min_ev FROM system_settings WHERE id = 1')?.min_ev ?? 0.05; }
 
-  rankScore(s: { ev_low: number | null; quality_score: number }): number {
-    return Math.max(0, s.ev_low ?? 0) * (s.quality_score / 100) + (s.quality_score / 100) * 0.001;
-  }
+  rankScore(s: { ev_low: number | null; quality_score: number }): number { return rankScore(s); }
 
   /** Prüft, ob ein Signal JETZT noch als aktuelle Pre-Match-Empfehlung gelten darf. */
   validate(s: RecSignal, now: Date): Validity {
@@ -93,15 +109,8 @@ export class RecommendationEngine {
     const cands = this.db.all<RecSignal>(`${SIGNAL_SQL} WHERE s.active = 1 AND s.status IN ('STRONG_VALUE','VALUE') AND e.kickoff_utc > ? ${includeMock ? '' : 'AND e.is_mock = 0'}`, nowIso(now));
     const valid: { s: RecSignal; v: Validity }[] = [];
     for (const s of cands) { const v = this.validate(s, now); if (v.ok) valid.push({ s, v }); }
-    const byEvent = new Map<number, typeof valid>();
-    for (const c of valid) byEvent.set(c.s.event_id, [...(byEvent.get(c.s.event_id) ?? []), c]);
-    const picks: { s: RecSignal; v: Validity; correlated: number[] }[] = [];
-    for (const list of byEvent.values()) {
-      const sorted = [...list].sort((a, b) => this.rankScore(b.s) - this.rankScore(a.s));
-      picks.push({ ...sorted[0], correlated: sorted.slice(1).map(x => x.s.id) });
-    }
-    picks.sort((a, b) => this.rankScore(b.s) - this.rankScore(a.s));
-    const top = picks.slice(0, max);
+    const vById = new Map(valid.map(x => [x.s.id, x.v]));
+    const top = selectTop(valid.map(x => x.s), max).map(t => ({ s: t.pick, v: vById.get(t.pick.id)!, correlated: t.correlated.map(c => c.id) }));
     this.db.tx(() => {
       const keep = new Set(top.map(t => t.s.id));
       for (const r of this.db.all<{ id: number; signal_id: number }>('SELECT id, signal_id FROM recommendations WHERE active = 1'))
diff --git a/backend/src/engines/validation.ts b/backend/src/engines/validation.ts
index 9250826..9320e25 100644
--- a/backend/src/engines/validation.ts
+++ b/backend/src/engines/validation.ts
@@ -15,6 +15,7 @@ import type { Db } from '../db/db.js';
 import { BacktestingEngine, type BacktestMetrics } from './backtest.js';
 import { historicalDataQuality, type DataQualityReport } from './dataQuality.js';
 import { nowIso } from '../util/core.js';
+import type { Strategy } from '../config.js';
 
 export const HISTORICAL_SOURCES = [
   {
@@ -32,12 +33,18 @@ export const HISTORICAL_SOURCES = [
 ];
 
 export interface ValidationReport {
-  id: number; generatedAt: string; status: 'VALIDATED' | 'UNVALIDATED' | 'FAILED';
+  id: number; generatedAt: string; status: 'VALIDATED' | 'PARTIAL' | 'UNVALIDATED' | 'FAILED';
   dataQuality: DataQualityReport; backtestRunId: number | null; metrics: BacktestMetrics | null; reasons: string[];
   sources: typeof HISTORICAL_SOURCES; markdown: string;
 }
 
-export function runValidation(db: Db, opts: { includeMock?: boolean; minMatches?: number; now?: Date } = {}): ValidationReport {
+export interface ValidationOptions { includeMock?: boolean; minMatches?: number; now?: Date; strategy?: Strategy; minEv?: number; modelWeight?: number | null; maxRecommendations?: number; timezone?: string }
+
+/**
+ * Einziger Weg zu einer neuen validierten Modellversion – manuell (Admin/CLI) UND automatisch (Scheduler, v0.4.0).
+ * Vorher rief der Scheduler BacktestingEngine direkt auf und umging die Datenqualitätsprüfung.
+ */
+export function runValidation(db: Db, opts: ValidationOptions = {}): ValidationReport {
   const started = nowIso();
   const id = Number(db.run("INSERT INTO diagnostic_runs (kind, started_at, status) VALUES ('validation', ?, 'running')", started).lastInsertRowid);
   const dq = historicalDataQuality(db, { includeMock: opts.includeMock, minMatches: opts.minMatches });
@@ -45,10 +52,15 @@ export function runValidation(db: Db, opts: { includeMock?: boolean; minMatches?
   let metrics: BacktestMetrics | null = null, runId: number | null = null;
   if (!dq.totals.usable && !opts.includeMock) reasons.push('Keine echten historischen Daten in ausreichender Menge und Qualität – Backtest nicht aussagekräftig. CSV-Dateien von football-data.co.uk importieren (mindestens 2–3 Saisons je Liga).');
   try {
-    // Harte Datenqualitäts-Befunde in Wettbewerben, die in den Backtest eingehen, verhindern VALIDATED
-    const blockers = dq.competitions.filter(c => c.finishedWithResult >= (opts.minMatches ?? 200) && (opts.includeMock || !c.isMock))
-      .flatMap(c => [...(c.duplicateMatches.length ? [`${c.name}: ${c.duplicateMatches.length} doppelte Spiele`] : []), ...(c.leakageCheck.violations ? [`${c.name}: Data Leakage`] : []), ...(c.implausibleScores ? [`${c.name}: ${c.implausibleScores} unplausible Ergebnisse`] : [])]);
-    const r = new BacktestingEngine(db).run({ includeMock: opts.includeMock, minMatches: opts.minMatches, now: opts.now, blockers });
+    // v0.4.0: harte Datenqualitäts-Befunde blockieren nur den betroffenen Wettbewerb (nicht alle anderen)
+    const blockersByCompetition: Record<number, string[]> = {};
+    for (const c of dq.competitions) {
+      if (c.finishedWithResult < (opts.minMatches ?? 200) || (!opts.includeMock && c.isMock)) continue;
+      const b = [...(c.duplicateMatches.length ? [`${c.name}: ${c.duplicateMatches.length} doppelte Spiele`] : []), ...(c.leakageCheck.violations ? [`${c.name}: Data Leakage`] : []), ...(c.implausibleScores ? [`${c.name}: ${c.implausibleScores} unplausible Ergebnisse`] : [])];
+      if (b.length) blockersByCompetition[c.competitionId] = b;
+    }
+    const r = new BacktestingEngine(db).run({ includeMock: opts.includeMock, minMatches: opts.minMatches, now: opts.now, blockersByCompetition,
+      strategy: opts.strategy, minEv: opts.minEv, modelWeight: opts.modelWeight, maxRecommendations: opts.maxRecommendations, timezone: opts.timezone });
     metrics = r.metrics; runId = r.runId;
     reasons.push(...metrics.validation.reasons);
   } catch (e) { reasons.push(`Backtest fehlgeschlagen: ${(e as Error).message}`); }
@@ -86,12 +98,19 @@ export function toMarkdown(r: ValidationReport): string {
       if (!v) continue;
       L.push(`| ${c.name} | ${k} | ${v.n} | ${f4(v.ensemble?.logLoss)} | ${f4(v.baseline?.logLoss)} | ${f4(v.market?.logLoss)} | ${f4(v.ensemble?.brier)} | ${f4(v.ece)} | ${pc(v.marketCoverage)} |`);
     }
+    if (m.scopes?.length) {
+      L.push('', '## Validierungsstatus je Wettbewerb und Markt', '', '| Wettbewerb | Markt | Status | Vergleich mit Markt | Holdout n | Markt n | ECE | Quotenzeit |', '|---|---|---|---|---|---|---|---|');
+      const ev = (e: string) => e === 'BETTER' ? 'Mehrwert belegt' : e === 'NOT_WORSE' ? 'nicht schlechter (kein Mehrwert-Nachweis)' : e === 'WORSE' ? 'schlechter' : 'nicht prüfbar';
+      for (const x of m.scopes) L.push(`| ${x.competition} | ${x.market} | **${x.status}** | ${ev(x.marketEvidence)} | ${x.n} | ${x.marketN} | ${f4(x.ece)} | ${x.oddsTimesEstimated ? 'geschätzt' : 'exakt/keine'} |`);
+      L.push('', 'Nur Bereiche mit Status VALIDATED gelten live als validiert. „Nicht schlechter als der Markt“ ist kein Nachweis eines Mehrwerts; STRONG_VALUE setzt einen belegten Mehrwert voraus.');
+    }
     L.push('', '## Simulierte Wettstrategie', '');
     L.push(m.betting ? `${m.betting.bets} Wetten · ROI ${pc(m.betting.roi)} · max. Drawdown ${m.betting.maxDrawdown} u · ${m.betting.note}` : (m.bettingIncompleteReason ?? 'keine'));
+    if (m.betting?.selection) L.push('', `Auswahl: ${m.betting.selection.rule}. Ausgeschlossen: Datenqualität ${m.betting.selection.excluded.insufficientData}, AVOID ${m.betting.selection.excluded.avoid}, korreliert (gleiches Spiel) ${m.betting.selection.excluded.correlatedSameEvent}, über Fensterlimit ${m.betting.selection.excluded.beyondWindowLimit}.`);
     L.push('');
   }
   L.push('## Ergebnis', '', `**${r.status}**`, '', ...r.reasons.map(x => `- ${x}`), '');
-  L.push('Ensemble-Gewichte und Mischgewicht werden nur aus einem bestandenen Backtest übernommen (VALIDATED); sonst gelten die vorläufigen Standardwerte und STRONG_VALUE bleibt gesperrt.', '');
+  L.push('Ensemble-Gewichte und Mischgewicht werden nur für validierte Bereiche (Wettbewerb × Markt) übernommen; sonst gelten die vorläufigen Standardwerte, Signale sind experimentell und STRONG_VALUE bleibt gesperrt.', '');
   L.push('## Datenquellen und Nutzungsbedingungen', '', ...r.sources.map(s => `- **${s.name}** – ${s.use}. ${s.terms}`), '');
   return L.join('\n');
 }
diff --git a/backend/src/engines/value.ts b/backend/src/engines/value.ts
index 2884178..993695f 100644
--- a/backend/src/engines/value.ts
+++ b/backend/src/engines/value.ts
@@ -11,14 +11,22 @@ import type { MarketId, SelectionId } from '../providers/types.js';
 import { MARKET_SELECTIONS } from '../providers/types.js';
 import type { PredictionRecord } from './prediction/index.js';
 import { OddsStore, consensusNoVig, type MarketBookView } from './odds.js';
-import { clamp, nowIso } from '../util/core.js';
+import { clamp, nowIso, sha, stableStringify } from '../util/core.js';
 import { checkFreshness } from './freshness.js';
 import type { Strategy } from '../config.js';
 
 export type SignalStatus = 'STRONG_VALUE' | 'VALUE' | 'WATCH' | 'NO_VALUE' | 'INSUFFICIENT_DATA' | 'STALE' | 'AVOID' | 'MARKET_SUSPENDED';
 export const QUALIFIED: SignalStatus[] = ['STRONG_VALUE', 'VALUE'];
 
-export interface ValueSettings { minEv: number; strategy: Strategy; oddsMaxAgeMinutes: number; preferredBookmakers: string[]; modelValidated: boolean; isMock: boolean; modelWeight?: number | null }
+export interface ValueSettings {
+  minEv: number; strategy: Strategy; oddsMaxAgeMinutes: number; preferredBookmakers: string[]; modelValidated: boolean; isMock: boolean; modelWeight?: number | null;
+  /** v0.4.0: Validierung je Markt für den Wettbewerb dieses Spiels (überschreibt modelValidated, wenn gesetzt). */
+  validatedMarkets?: MarketId[];
+  /** v0.4.0: Märkte, in denen ein Mehrwert gegenüber dem Markt statistisch nachgewiesen ist (Voraussetzung für STRONG_VALUE). */
+  marketEdgeMarkets?: MarketId[];
+  /** v0.4.0: im Backtest gewähltes Mischgewicht je Markt (nur für validierte Märkte). */
+  modelWeightByMarket?: Partial<Record<MarketId, number>>;
+}
 
 export interface Signal {
   eventId: number; predictionId: number; market: MarketId; selection: SelectionId; line: number | null;
@@ -31,6 +39,23 @@ export interface Signal {
   validatedAt: string; validUntil: string | null;
   /** Herkunft des fairen Marktpreises (ohne den bewerteten Buchmacher) */
   marketRefSource: string | null;
+  /**
+   * v0.4.0: Signatur aller fachlich relevanten Berechnungswerte und Eingaben (Prognose, beste Quote, Marktreferenz,
+   * Wahrscheinlichkeiten, EV, Status und Konfiguration). Ändert sich einer davon, entsteht eine neue Signalversion.
+   */
+  calcSignature: string;
+}
+
+/** Zahlen auf 9 Stellen runden, damit Gleitkomma-Rauschen keine Scheinänderung erzeugt. */
+const r9 = (x: number | null) => x == null || !Number.isFinite(x) ? null : Math.round(x * 1e9) / 1e9;
+
+export function signalSignature(s: Omit<Signal, 'calcSignature'>, cfg: ValueSettings): string {
+  return sha(stableStringify({
+    p: s.predictionId, st: s.status, ln: s.line, snap: s.bestSnapshotId, bk: s.bestBookmakerId, odds: r9(s.bestOdds), ref: s.marketRefSource, books: s.bookCount,
+    pm: r9(s.modelProb), pd: r9(s.decisionProb), w: r9(s.modelWeight), lo: r9(s.probLow), nv: r9(s.novigProb), ev: r9(s.ev), evl: r9(s.evLow), edge: r9(s.edge),
+    cfg: { minEv: r9(cfg.minEv), strategy: cfg.strategy, w: r9(cfg.modelWeight ?? null), validated: cfg.modelValidated, mock: cfg.isMock, pref: [...cfg.preferredBookmakers].sort(), maxAge: cfg.oddsMaxAgeMinutes,
+      vm: cfg.validatedMarkets ?? null, em: cfg.marketEdgeMarkets ?? null, wm: cfg.modelWeightByMarket ?? null },
+  }), 24);
 }
 
 const Z: Record<Strategy, number> = { CONSERVATIVE: 1.645, BALANCED: 1.0, AGGRESSIVE: 0.5 };
@@ -40,6 +65,51 @@ const AVOID_GAP = 0.12;
 export const DEFAULT_MODEL_WEIGHT: Record<Strategy, number> = { CONSERVATIVE: 0.25, BALANCED: 0.35, AGGRESSIVE: 0.5 };
 const MARKET_SD = 0.015;
 
+export interface DecisionInput {
+  p: number; sd: number | null; bestOdds: number; novig: number | null; strategy: Strategy; minEv: number; modelWeight?: number | null;
+  dqScore: number; agreement: number; modelValidated: boolean; marketEdgeProven: boolean; isMock: boolean;
+  /** 0..1 (1 = gerade abgerufen); im Backtest 0, weil historische Abrufzeitpunkte nur geschätzt sind */
+  freshness: number; freshBooks: number; marketRefSource: string | null;
+}
+export interface Decision { status: Extract<SignalStatus, 'STRONG_VALUE' | 'VALUE' | 'WATCH' | 'NO_VALUE' | 'AVOID'>; modelWeight: number; decisionProb: number; probLow: number; ev: number; evLow: number; edge: number | null; qualityScore: number; reasons: string[] }
+
+/**
+ * v0.4.0: EINE Entscheidungsregel für Live-Betrieb und Backtest (vorher im Backtest nachgebaut, ohne Datenqualität,
+ * AVOID-Regel und Strategie-z). Reine Funktion ohne Datenbankzugriff.
+ */
+export function decide(i: DecisionInput): Decision {
+  const reasons: string[] = [];
+  const z = Z[i.strategy];
+  const sigma = i.sd ?? 0.05;
+  const w = i.novig != null ? clamp(i.modelWeight ?? DEFAULT_MODEL_WEIGHT[i.strategy], 0, 1) : 1;
+  const pDec = i.novig != null ? w * i.p + (1 - w) * i.novig : i.p;
+  const sDec = i.novig != null ? Math.sqrt((w * sigma) ** 2 + ((1 - w) * MARKET_SD) ** 2) : sigma;
+  const probLow = clamp(pDec - z * sDec, 0.001, 0.999);
+  const ev = pDec * i.bestOdds - 1, evLow = probLow * i.bestOdds - 1;
+  const edge = i.novig != null ? i.p - i.novig : null;
+  if (i.novig == null) reasons.push('kein fairer Marktpreis ohne den bewerteten Buchmacher verfügbar: Entscheidung nur auf Modellbasis mit voller Unsicherheit');
+  const qualityScore = Math.round(i.dqScore * 0.4 + i.freshness * 15 + i.agreement * 15 + (i.modelValidated ? 15 : 0) + Math.min(15, i.freshBooks * 3.75));
+  const out = (status: Decision['status']): Decision => ({ status, modelWeight: w, decisionProb: pDec, probLow, ev, evLow, edge, qualityScore, reasons });
+  if (edge != null && Math.abs(edge) > AVOID_GAP) {
+    reasons.push(`Modell weicht ${(edge * 100).toFixed(1)} Prozentpunkte vom fairen Marktpreis ab (${i.marketRefSource}). Das deutet eher auf fehlende Informationen oder Datenfehler hin als auf Value.`);
+    return out('AVOID');
+  }
+  if (ev < i.minEv) { reasons.push(`EV ${(ev * 100).toFixed(1)} % unter Mindest-EV ${(i.minEv * 100).toFixed(0)} %`); return out('NO_VALUE'); }
+  const dqOk = i.dqScore >= MIN_DQ[i.strategy];
+  if (evLow > 0 && dqOk) {
+    reasons.push(`EV ${(ev * 100).toFixed(1)} %, auch an der Untergrenze positiv (${(evLow * 100).toFixed(1)} %)`);
+    if (!i.modelValidated) reasons.push('Modell für diesen Markt/Wettbewerb UNVALIDATED: experimentelles Signal, kein nachgewiesener Vorteil');
+    else if (!i.marketEdgeProven) reasons.push('Modell validiert, aber kein statistisch nachgewiesener Mehrwert gegenüber dem Markt: STRONG_VALUE gesperrt');
+    return out(i.modelValidated && i.marketEdgeProven && !i.isMock && evLow >= 0.03 && i.dqScore >= 75 ? 'STRONG_VALUE' : 'VALUE');
+  }
+  if (evLow <= 0) reasons.push(`EV ${(ev * 100).toFixed(1)} %, aber an der Untergrenze ${(evLow * 100).toFixed(1)} %: Vorteil liegt innerhalb der Modellunsicherheit`);
+  if (!dqOk) reasons.push(`Datenqualität ${i.dqScore} unter Mindestwert ${MIN_DQ[i.strategy]} (${i.strategy})`);
+  return out('WATCH');
+}
+
+/** Mindest-Datenqualität je Strategie (gleich für Live und Backtest). */
+export const MIN_DATA_QUALITY = MIN_DQ;
+
 export class ValueBettingEngine {
   private odds: OddsStore;
   private kickoff = '';
@@ -54,7 +124,11 @@ export class ValueBettingEngine {
       const line = market === 'OU' ? 2.5 : null;
       const views = this.odds.latestPerBookmaker(pred.eventId, market, line);
       const p = pred.ensemble.probs[market], sd = pred.ensemble.sd[market];
-      for (const sel of MARKET_SELECTIONS[market]) out.push(this.one(pred, market, sel, line, views, p?.[sel] ?? null, sd?.[sel] ?? null, s, now, started));
+      for (const sel of MARKET_SELECTIONS[market]) {
+        const sig = this.one(pred, market, sel, line, views, p?.[sel] ?? null, sd?.[sel] ?? null, s, now, started);
+        sig.calcSignature = signalSignature(sig, s);
+        out.push(sig);
+      }
     }
     return out;
   }
@@ -63,7 +137,7 @@ export class ValueBettingEngine {
     const reasons: string[] = [];
     const base: Signal = { eventId: pred.eventId, predictionId: pred.id, market, selection: sel, line, status: 'NO_VALUE', modelProb: p, decisionProb: null, modelWeight: null, probLow: null, impliedProb: null, novigProb: null,
       fairOdds: p ? 1 / p : null, bestOdds: null, bestBookmakerId: null, bestSnapshotId: null, edge: null, ev: null, evLow: null, qualityScore: 0, reasons, bookCount: 0,
-      oddsRetrievedAt: null, oddsSourceTimestamp: null, validatedAt: nowIso(now), validUntil: null, marketRefSource: null };
+      oddsRetrievedAt: null, oddsSourceTimestamp: null, validatedAt: nowIso(now), validUntil: null, marketRefSource: null, calcSignature: '' };
     if (s.isMock) reasons.push('MOCK-Daten: nur Entwicklungsmodus');
     if (started) { base.status = 'STALE'; reasons.push('Spiel hat begonnen oder ist nicht mehr angesetzt'); return base; }
     // Frische je Buchmacher mit denselben Regeln wie bei der Aufnahme (strenger, je näher der Anstoß)
@@ -92,38 +166,17 @@ export class ValueBettingEngine {
       reasons.push(p == null ? 'kein Modell für diesen Markt verfügbar' : 'Datenqualität unzureichend: ' + pred.dataQuality.issues.slice(0, 2).join('; '));
       return base;
     }
-    const z = Z[s.strategy];
-    const sigma = sd ?? 0.05;
-    const w = base.novigProb != null ? clamp(s.modelWeight ?? DEFAULT_MODEL_WEIGHT[s.strategy], 0, 1) : 1;
-    const pDec = base.novigProb != null ? w * p + (1 - w) * base.novigProb : p;
-    const sDec = base.novigProb != null ? Math.sqrt((w * sigma) ** 2 + ((1 - w) * MARKET_SD) ** 2) : sigma;
-    base.modelWeight = w; base.decisionProb = pDec; base.fairOdds = 1 / pDec;
-    base.probLow = clamp(pDec - z * sDec, 0.001, 0.999);
-    base.ev = pDec * base.bestOdds - 1;
-    base.evLow = base.probLow * base.bestOdds - 1;
-    base.edge = base.novigProb != null ? p - base.novigProb : null;
-    if (base.novigProb == null) reasons.push('kein fairer Marktpreis ohne den bewerteten Buchmacher verfügbar: Entscheidung nur auf Modellbasis mit voller Unsicherheit');
     const f = fr.get(best.snapshotId)!;
-    const freshness = f.ageMinutes == null ? 0 : clamp(1 - f.ageMinutes / f.limitMinutes, 0, 1);
-    const q = pred.dataQuality.score * 0.4 + freshness * 15 + pred.ensemble.agreement * 15 + (s.modelValidated ? 15 : 0) + Math.min(15, fresh.length * 3.75);
-    base.qualityScore = Math.round(q);
-    if (base.edge != null && Math.abs(base.edge) > AVOID_GAP) {
-      base.status = 'AVOID';
-      reasons.push(`Modell weicht ${(base.edge * 100).toFixed(1)} Prozentpunkte vom fairen Marktpreis ab (${cons?.source}). Das deutet eher auf fehlende Informationen oder Datenfehler hin als auf Value.`);
-      return base;
-    }
-    if (base.ev >= s.minEv) {
-      const dqOk = pred.dataQuality.score >= MIN_DQ[s.strategy];
-      if (base.evLow > 0 && dqOk) {
-        base.status = s.modelValidated && !s.isMock && base.evLow >= 0.03 && pred.dataQuality.score >= 75 ? 'STRONG_VALUE' : 'VALUE';
-        reasons.push(`EV ${(base.ev * 100).toFixed(1)} %, auch an der Untergrenze positiv (${(base.evLow * 100).toFixed(1)} %)`);
-        if (!s.modelValidated) reasons.push('Modell UNVALIDATED: STRONG_VALUE erst nach bestandenem Backtest');
-      } else {
-        base.status = 'WATCH';
-        if (base.evLow <= 0) reasons.push(`EV ${(base.ev * 100).toFixed(1)} %, aber an der Untergrenze ${(base.evLow * 100).toFixed(1)} %: Vorteil liegt innerhalb der Modellunsicherheit`);
-        if (!dqOk) reasons.push(`Datenqualität ${pred.dataQuality.score} unter Mindestwert ${MIN_DQ[s.strategy]} (${s.strategy})`);
-      }
-    } else reasons.push(`EV ${(base.ev * 100).toFixed(1)} % unter Mindest-EV ${(s.minEv * 100).toFixed(0)} %`);
+    const validated = s.validatedMarkets ? s.validatedMarkets.includes(market) : s.modelValidated;
+    const d = decide({
+      p, sd, bestOdds: base.bestOdds, novig: base.novigProb, strategy: s.strategy, minEv: s.minEv,
+      modelWeight: s.modelWeightByMarket?.[market] ?? s.modelWeight, dqScore: pred.dataQuality.score, agreement: pred.ensemble.agreement,
+      modelValidated: validated, marketEdgeProven: s.marketEdgeMarkets ? s.marketEdgeMarkets.includes(market) : validated, isMock: s.isMock,
+      freshness: f.ageMinutes == null ? 0 : clamp(1 - f.ageMinutes / f.limitMinutes, 0, 1), freshBooks: fresh.length, marketRefSource: cons?.source ?? null,
+    });
+    base.modelWeight = d.modelWeight; base.decisionProb = d.decisionProb; base.fairOdds = 1 / d.decisionProb;
+    base.probLow = d.probLow; base.ev = d.ev; base.evLow = d.evLow; base.edge = d.edge; base.qualityScore = d.qualityScore; base.status = d.status;
+    reasons.push(...d.reasons);
     return base;
   }
 
@@ -134,17 +187,19 @@ export class ValueBettingEngine {
       for (const s of signals) {
         const prev = this.db.get<StoredSignal>(`SELECT * FROM value_signals WHERE event_id = ? AND market_id = ? AND selection_id = ? AND ${s.line == null ? 'line IS NULL' : 'line = ?'} AND active = 1`,
           ...([s.eventId, s.market, s.selection, ...(s.line == null ? [] : [s.line])] as (string | number)[])) ?? null;
-        if (prev && prev.prediction_id === s.predictionId && prev.status === s.status && prev.best_snapshot_id === s.bestSnapshotId) {
-          // inhaltlich unverändert: nur Validierungszeitpunkt und Gültigkeit fortschreiben
-          this.db.run('UPDATE value_signals SET validated_at = ?, valid_until = ? WHERE id = ?', s.validatedAt, s.validUntil, prev.id);
+        // v0.4.0: unverändert nur, wenn ALLE Berechnungswerte und Eingaben gleich sind (Signatur). Vorher genügten
+        // prediction_id, status und best_snapshot_id – geänderte Marktreferenz, Gewichte oder Strategie gingen verloren.
+        if (prev && prev.calc_signature && prev.calc_signature === s.calcSignature) {
+          // Nur zeitabhängige Felder fortschreiben (Qualitätswert enthält die Quotenfrische); Berechnungswerte bleiben.
+          this.db.run('UPDATE value_signals SET validated_at = ?, valid_until = ?, quality_score = ? WHERE id = ?', s.validatedAt, s.validUntil, s.qualityScore, prev.id);
           continue;
         }
-        if (prev) this.db.run('UPDATE value_signals SET active = 0, deactivated_at = ?, deactivation_reason = ? WHERE id = ?', nowIso(now), 'ersetzt durch neue Berechnung', prev.id);
+        if (prev) this.db.run('UPDATE value_signals SET active = 0, deactivated_at = ?, deactivation_reason = ? WHERE id = ?', nowIso(now), changeReason(prev, s), prev.id);
         const id = this.db.run(`INSERT INTO value_signals (event_id, prediction_id, market_id, selection_id, line, status, model_prob, decision_prob, model_weight, prob_low, implied_prob, novig_prob, fair_odds, best_odds, best_bookmaker_id, best_snapshot_id, edge, ev, ev_low, quality_score, reasons, active, created_at,
-                                  odds_retrieved_at, odds_source_timestamp, validated_at, valid_until, market_ref_source)
-                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
+                                  odds_retrieved_at, odds_source_timestamp, validated_at, valid_until, market_ref_source, calc_signature)
+                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
           s.eventId, s.predictionId, s.market, s.selection, s.line, s.status, s.modelProb, s.decisionProb, s.modelWeight, s.probLow, s.impliedProb, s.novigProb, s.fairOdds, s.bestOdds, s.bestBookmakerId, s.bestSnapshotId, s.edge, s.ev, s.evLow, s.qualityScore, JSON.stringify(s.reasons), nowIso(now),
-          s.oddsRetrievedAt, s.oddsSourceTimestamp, s.validatedAt, s.validUntil, s.marketRefSource).lastInsertRowid;
+          s.oddsRetrievedAt, s.oddsSourceTimestamp, s.validatedAt, s.validUntil, s.marketRefSource, s.calcSignature).lastInsertRowid;
         changes.push({ prev, next: this.db.get<StoredSignal>('SELECT * FROM value_signals WHERE id = ?', id)! });
       }
     });
@@ -164,10 +219,24 @@ export class ValueBettingEngine {
   expireStarted(now: Date = new Date()): number { return this.expire(now); }
 }
 
+/** Nachvollziehbarer Grund für eine neue Signalversion (für Transparenz in der Historie). */
+function changeReason(prev: StoredSignal, s: Signal): string {
+  const d: string[] = [];
+  const ne = (a: number | null, b: number | null) => r9(a) !== r9(b);
+  if (prev.prediction_id !== s.predictionId) d.push('neue Prognose');
+  if (prev.status !== s.status) d.push(`Status ${prev.status}→${s.status}`);
+  if (prev.best_snapshot_id !== s.bestSnapshotId) d.push('neue beste Quote');
+  if (ne(prev.novig_prob, s.novigProb) || prev.market_ref_source !== s.marketRefSource) d.push('Marktreferenz geändert');
+  if (ne(prev.model_weight, s.modelWeight)) d.push('Modellgewicht geändert');
+  if (ne(prev.prob_low, s.probLow) && !ne(prev.decision_prob, s.decisionProb)) d.push('Unsicherheit/Strategie geändert');
+  if (ne(prev.decision_prob, s.decisionProb) || ne(prev.ev, s.ev)) d.push('Entscheidungswahrscheinlichkeit/EV geändert');
+  return 'ersetzt durch neue Berechnung' + (d.length ? ': ' + d.join(', ') : ' (Konfiguration geändert)');
+}
+
 export interface StoredSignal {
   id: number; event_id: number; prediction_id: number; market_id: MarketId; selection_id: SelectionId; line: number | null; status: SignalStatus;
   model_prob: number | null; decision_prob: number | null; model_weight: number | null; prob_low: number | null; implied_prob: number | null; novig_prob: number | null; fair_odds: number | null; best_odds: number | null;
   best_bookmaker_id: string | null; best_snapshot_id: string | null; edge: number | null; ev: number | null; ev_low: number | null; quality_score: number;
   reasons: string; active: number; created_at: string;
-  odds_retrieved_at: string | null; odds_source_timestamp: string | null; validated_at: string | null; valid_until: string | null; market_ref_source: string | null;
+  odds_retrieved_at: string | null; odds_source_timestamp: string | null; validated_at: string | null; valid_until: string | null; market_ref_source: string | null; calc_signature: string | null;
 }
diff --git a/backend/src/env.ts b/backend/src/env.ts
new file mode 100644
index 0000000..7606488
--- /dev/null
+++ b/backend/src/env.ts
@@ -0,0 +1,38 @@
+/**
+ * .env-Laden (v0.4.0) – eindeutig und ohne Abhängigkeiten.
+ *
+ * Reihenfolge:
+ *  1. ENV_FILE=<pfad> → genau diese Datei (ENV_FILE=none → keine Datei laden)
+ *  2. sonst die erste vorhandene von: ./.env (Arbeitsverzeichnis), ../.env, <Projektwurzel>/.env
+ * Echte Umgebungsvariablen haben IMMER Vorrang (Secrets aus Hosting/Codespaces/Docker werden nie überschrieben).
+ * Es werden nur Dateiname und Anzahl der übernommenen Schlüssel gemeldet – nie Werte.
+ * Wird als ERSTER Import von main.ts/cli.ts ausgeführt, vor allen Modulen, die Umgebungsvariablen lesen.
+ */
+import fs from 'node:fs';
+import path from 'node:path';
+import { parseEnv } from 'node:util';
+import { fileURLToPath } from 'node:url';
+
+export interface EnvLoadResult { file: string | null; applied: number; skippedExisting: number; error: string | null }
+
+export function loadDotEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): EnvLoadResult {
+  const explicit = env.ENV_FILE?.trim();
+  if (explicit && explicit.toLowerCase() === 'none') return { file: null, applied: 0, skippedExisting: 0, error: null };
+  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // dist/src/env.js → Projektwurzel
+  const candidates = explicit ? [path.resolve(cwd, explicit)] : [path.join(cwd, '.env'), path.join(cwd, '..', '.env'), path.join(root, '.env')];
+  const file = candidates.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) ?? null;
+  if (!file) return { file: null, applied: 0, skippedExisting: 0, error: explicit ? `ENV_FILE nicht gefunden: ${explicit}` : null };
+  let parsed: Record<string, string>;
+  try { parsed = parseEnv(fs.readFileSync(file, 'utf8')) as Record<string, string>; }
+  catch (e) { return { file, applied: 0, skippedExisting: 0, error: `ENV-Datei nicht lesbar: ${(e as Error).message.slice(0, 120)}` }; }
+  let applied = 0, skipped = 0;
+  for (const [k, v] of Object.entries(parsed)) {
+    if (env[k] !== undefined) { skipped++; continue; }   // echte Umgebung gewinnt
+    if (v === '') continue;                                // leere Platzhalter aus .env.example nicht als gesetzt werten
+    env[k] = v; applied++;
+  }
+  return { file, applied, skippedExisting: skipped, error: null };
+}
+
+/** Ergebnis des Ladens beim Prozessstart (für die Startmeldung). */
+export const envLoad: EnvLoadResult = loadDotEnv();
diff --git a/backend/src/main.ts b/backend/src/main.ts
index c18f169..e628f81 100644
--- a/backend/src/main.ts
+++ b/backend/src/main.ts
@@ -1,10 +1,15 @@
-import { loadConfig, configIssues } from './config.js';
+import { envLoad } from './env.js';
+import { loadConfig, configIssues, ConfigError } from './config.js';
 import { buildApp, seedMock } from './app.js';
 import { Scheduler } from './scheduler.js';
 import { createServer } from './server.js';
 import { log } from './util/log.js';
 
-const cfg = loadConfig();
+let cfg: ReturnType<typeof loadConfig>;
+try { cfg = loadConfig(); }
+catch (e) { if (e instanceof ConfigError) { console.error(`Konfigurationsfehler: ${e.message}`); process.exit(2); } throw e; }
+if (envLoad.error) log.warn(envLoad.error);
+log.info(envLoad.file ? `Umgebung: ${envLoad.file} geladen (${envLoad.applied} Variablen übernommen; ${envLoad.skippedExisting} bereits in der Umgebung gesetzt – Umgebung hat Vorrang). Werte werden nicht ausgegeben.` : 'Umgebung: keine .env-Datei geladen (nur echte Umgebungsvariablen).');
 const app = buildApp(cfg);
 for (const i of configIssues(cfg)) log.warn(i);
 if (cfg.dataMode === 'mock') {
diff --git a/backend/src/providers/theOddsApi.ts b/backend/src/providers/theOddsApi.ts
index d4e9e0b..88fa74b 100644
--- a/backend/src/providers/theOddsApi.ts
+++ b/backend/src/providers/theOddsApi.ts
@@ -18,6 +18,14 @@
  *  - Über/Unter nur Linie 2,5 (andere Linien werden gar nicht erst als Snapshot angelegt)
  *  - h2h_3_way wird wie h2h behandelt, falls ein Buchmacher nur diesen Markt liefert (Unentschieden Pflicht)
  *  - paidGate: kostenpflichtige Abrufe erst nach erfolgreichem, authentifiziertem Verbindungstest (siehe oddsApiStatus.ts)
+ *
+ * v0.4.0:
+ *  - Zeitfenster für /events und /odds auf volle Stunden gerundet → stabiler Cache-Schlüssel (vorher sekundengenau:
+ *    jeder Lauf erzeugte einen neuen Schlüssel, Cache-Treffer waren praktisch unmöglich). Ergebnis wird exakt nachgefiltert.
+ *  - Quotenabruf budgetgesteuert: VOR dem ersten kostenpflichtigen Abruf wird geprüft, wie viele Wettbewerbe Tages-,
+ *    Monatsbudget und Anbieter-Restcredits zulassen (nächste Anstöße zuerst). Der Rest wird mit Grund übersprungen.
+ *  - lastEvents enthält nur Spiele des angefragten Fensters, die noch nicht begonnen haben, und wird nach dem Lauf geleert.
+ *  - Ergebnisse gebündelt je Wettbewerb (resultsFor): ein /scores-Abruf nur für Wettbewerbe mit offenen Spielen ≤ 3 Tage.
  */
 import type { ApiQueue } from '../api/apiQueue.js';
 import type { FootballDataProvider, MarketId, OddsProvider, ProviderCapabilities, ProviderCompetition, ProviderFixture, ProviderOddsQuote, ProviderRunReport, SelectionId } from './types.js';
@@ -62,6 +70,15 @@ export function oddsApiUrl(baseUrl: string, apiKey: string, path: string, params
   return u.toString();
 }
 
+const HOUR = 3_600_000;
+/** Fenster auf volle Stunden runden (from abwärts, to aufwärts) – stabiler Cache-Schlüssel, Ergebnis wird exakt gefiltert. */
+export function hourWindow(from: Date, to: Date): { from: Date; to: Date } {
+  return { from: new Date(Math.floor(from.getTime() / HOUR) * HOUR), to: new Date(Math.ceil(to.getTime() / HOUR) * HOUR) };
+}
+const isoS = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
+/** /scores?daysFrom=3 liefert nur Spiele der letzten 3 Tage. */
+export const SCORES_DAYS = 3;
+
 /** Märkte von /odds (je Region 1 Credit pro gelieferter Markt). */
 export const ODDS_MARKETS = 'h2h,totals';
 export const OU_LINE = 2.5;
@@ -85,9 +102,9 @@ export class TheOddsApiProvider implements OddsProvider, FootballDataProvider {
   private report: ProviderRunReport;
   private resolvedKeys: string[] | null = null;
   private clock: Date | null = null;
-  /** Uhr des Laufs (Discovery setzt sie); ohne Angabe Systemzeit. */
+  /** Uhr des Laufs (Discovery setzt sie); ohne Angabe die Uhr der API-Queue. */
   setNow(now: Date): void { this.clock = now; }
-  private now(): Date { return this.clock ?? new Date(); }
+  private now(): Date { return this.clock ?? this.q.currentTime(); }
 
   constructor(private q: ApiQueue, private o: TheOddsApiOptions) { this.report = emptyReport(o.sportKeys); }
 
@@ -137,12 +154,10 @@ export class TheOddsApiProvider implements OddsProvider, FootballDataProvider {
 
   /** Reine Spielsuche: /events ist laut offizieller V4-Doku kostenlos (0 Credits). */
   private async upcomingEvents(sport: string, from: Date, to: Date): Promise<OaEvent[]> {
-    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
+    const w = hourWindow(from, to);
     const data = await this.q.request<OaEvent[]>({
       provider: this.name,
-      url: this.url(`/v4/sports/${encodeURIComponent(sport)}/events`, {
-        dateFormat: 'iso', commenceTimeFrom: iso(from), commenceTimeTo: iso(to),
-      }),
+      url: this.url(`/v4/sports/${encodeURIComponent(sport)}/events`, { dateFormat: 'iso', commenceTimeFrom: isoS(w.from), commenceTimeTo: isoS(w.to) }),
       ttlSeconds: 300, priority: 5, cost: 0, noRetry: true,
       note: `events (kostenlos) ${sport}`,
     });
@@ -157,21 +172,37 @@ export class TheOddsApiProvider implements OddsProvider, FootballDataProvider {
 
   /** Kostenpflichtiger Quotenabruf erst nach kontrollierter Spielsuche. */
   private async eventsWithOdds(sport: string, from: Date, to: Date): Promise<OaEvent[]> {
-    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
+    const w = hourWindow(from, to);
     const r = await this.q.requestMeta<OaEvent[]>({
       provider: this.name,
       url: this.paidUrl(`/v4/sports/${encodeURIComponent(sport)}/odds`, {
         regions: this.o.regions, markets: ODDS_MARKETS, oddsFormat: 'decimal', dateFormat: 'iso',
-        commenceTimeFrom: iso(from), commenceTimeTo: iso(to),
+        commenceTimeFrom: isoS(w.from), commenceTimeTo: isoS(w.to),
       }),
-      ttlSeconds: ODDS_CACHE_MAX_SECONDS, maxCacheAgeSeconds: this.cacheRule, priority: 2, cost: 2 * this.regionCount(),
+      ttlSeconds: ODDS_CACHE_MAX_SECONDS, maxCacheAgeSeconds: this.cacheRule, priority: 2, cost: this.oddsCost(),
       note: `odds h2h,totals ${sport}`,
     });
-    for (const e of r.data ?? []) this.lastEvents.set(e.id, { e, fetchedAt: r.fetchedAt, fromCache: r.fromCache });
-    return r.data ?? [];
+    const now = this.now().getTime();
+    const list = (r.data ?? []).filter(e => { const t = Date.parse(e.commence_time); return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime() && t > now; });
+    for (const e of list) this.lastEvents.set(e.id, { e, fetchedAt: r.fetchedAt, fromCache: r.fromCache });
+    return list;
   }
 
   private regionCount(): number { return Math.max(1, this.o.regions.split(',').filter(Boolean).length); }
+  /** Kosten eines /odds-Abrufs: Märkte × Regionen (offizielle V4-Doku). */
+  oddsCost(): number { return ODDS_MARKETS.split(',').length * this.regionCount(); }
+
+  /** Frei verfügbare Credits: Minimum aus internem Tages-/Monatsbudget und vom Anbieter gemeldeten Restcredits. */
+  private creditsAvailable(): { credits: number; limitedBy: string } {
+    const b = this.q.budgetStatus(this.name);
+    const c: [number, string][] = [[b.remainingBudget, `Tagesbudget (${b.used}/${b.budget})`]];
+    if (b.monthlyBudget != null) c.push([Math.max(0, b.monthlyBudget - b.usedMonth), `Monatsbudget (${b.usedMonth}/${b.monthlyBudget})`]);
+    const prov = this.q.providerReportedRemaining(this.name);
+    if (prov != null) c.push([prov, `Anbieter-Restcredits (${prov})`]);
+    if (b.paused) c.push([0, `gesperrt bis ${b.pausedUntil}`]);
+    const min = c.reduce((a, x) => (x[0] < a[0] ? x : a));
+    return { credits: Math.max(0, min[0]), limitedBy: min[1] };
+  }
 
   async upcomingFixtures(fromUtc: Date, toUtc: Date): Promise<ProviderFixture[]> {
     this.report = emptyReport(this.o.sportKeys); this.resolvedKeys = null;
@@ -187,20 +218,41 @@ export class TheOddsApiProvider implements OddsProvider, FootballDataProvider {
 
   async historicalResults(_c: ProviderCompetition, _s: string | null): Promise<ProviderFixture[]> { return []; }
 
-  /** Ergebnis eines Spiels über /scores (gebündelt je Wettbewerb, Cache 30 min). */
+  private async scores(sport: string): Promise<OaScore[]> {
+    return (await this.q.request<OaScore[]>({
+      provider: this.name, url: this.paidUrl(`/v4/sports/${encodeURIComponent(sport)}/scores`, { daysFrom: String(SCORES_DAYS), dateFormat: 'iso' }),
+      ttlSeconds: 30 * 60, priority: 1, cost: 2, note: `scores daysFrom=${SCORES_DAYS} ${sport}`,
+    })) ?? [];
+  }
+
+  /** Ergebnis eines Spiels über /scores (Altweg; bevorzugt resultsFor). */
   async matchDetails(providerEventId: string): Promise<ProviderFixture | null> {
     if (this.o.resultsEnabled === false) return null;
     for (const sport of await this.sportKeys()) {
-      const rows = await this.q.request<OaScore[]>({
-        provider: this.name, url: this.paidUrl(`/v4/sports/${encodeURIComponent(sport)}/scores`, { daysFrom: '3', dateFormat: 'iso' }),
-        ttlSeconds: 30 * 60, priority: 1, cost: 2, note: `scores daysFrom=3 ${sport}`,
-      });
-      const s = (rows ?? []).find(r => r.id === providerEventId);
+      const s = (await this.scores(sport)).find(r => r.id === providerEventId);
       if (s) return scoreToFixture(s, this.now());
     }
     return null;
   }
 
+  /**
+   * v0.4.0: Ergebnisse gebündelt – genau ein /scores-Abruf (2 Credits) je Wettbewerb, der offene Spiele der letzten
+   * SCORES_DAYS Tage hat. Spiele ohne bekannten Wettbewerb oder älter als SCORES_DAYS lösen keinen Abruf aus.
+   */
+  async resultsFor(items: { providerEventId: string; competitionProviderId: string | null; kickoffUtc: string }[]): Promise<ProviderFixture[]> {
+    if (this.o.resultsEnabled === false) return [];
+    const minKick = this.now().getTime() - SCORES_DAYS * 86_400_000;
+    const allowed = new Set(await this.sportKeys());
+    const bySport = new Map<string, Set<string>>();
+    for (const it of items) {
+      if (!it.competitionProviderId || !allowed.has(it.competitionProviderId) || Date.parse(it.kickoffUtc) < minKick) continue;
+      (bySport.get(it.competitionProviderId) ?? bySport.set(it.competitionProviderId, new Set()).get(it.competitionProviderId)!).add(it.providerEventId);
+    }
+    const out: ProviderFixture[] = [];
+    for (const [sport, ids] of bySport) for (const s of await this.scores(sport)) if (ids.has(s.id)) out.push(scoreToFixture(s, this.now()));
+    return out;
+  }
+
   async oddsForFixtures(fixtures: ProviderFixture[]): Promise<ProviderOddsQuote[]> {
     const out: ProviderOddsQuote[] = [];
     // Ohne priorisierte Spiele keine kostenpflichtige Quotenabfrage.
@@ -210,27 +262,41 @@ export class TheOddsApiProvider implements OddsProvider, FootballDataProvider {
     }
     // /events hat KEINE Quoten geliefert. Quoten erst hier, einmal je Sport und Fenster abrufen.
     this.lastEvents.clear();
-    const valid = fixtures.filter(f => Number.isFinite(Date.parse(f.kickoffUtc)));
-    if (!valid.length) return out;
-    const from = new Date(Math.min(...valid.map(f => Date.parse(f.kickoffUtc))) - 3_600_000);
-    const to = new Date(Math.max(...valid.map(f => Date.parse(f.kickoffUtc))) + 3_600_000);
-    const keys = [...new Set(valid.filter(f => f.provider === this.name && f.competition.providerId).map(f => f.competition.providerId))];
-    // Für Fremd-Provider-Events alle konfigurierten Sport-Keys prüfen (Fixture-Matching erst nach Abruf).
-    // DB-Ansicht fixturesForEvents() führt keine Provider-Competition-ID mit; dann die freigegebenen Sport-Keys verwenden.
-    const sports = valid.some(f => f.provider !== this.name) || !keys.length ? await this.sportKeys() : keys;
-    for (const sport of sports) await this.eventsWithOdds(sport, from, to);
-    const wanted = new Set(valid.filter(f => f.provider === this.name).map(f => f.providerEventId));
-    const all = valid.some(f => f.provider !== this.name);
-    const selected = [...this.lastEvents.values()].filter(({ e }) => all || wanted.has(e.id));
-    for (const { e, fetchedAt, fromCache } of selected) {
-      const qs = convertOaEvent(e, fetchedAt, { onlyOuLine: OU_LINE }).map(q => ({ ...q, fromCache }));
-      if (qs.some(q => q.market === '1X2')) this.report.markets['1X2'].events++;
-      if (qs.some(q => q.market === 'OU')) this.report.markets.OU.events++;
-      out.push(...qs);
+    try {
+      const nowMs = this.now().getTime();
+      const valid = fixtures.filter(f => Number.isFinite(Date.parse(f.kickoffUtc)) && Date.parse(f.kickoffUtc) > nowMs);
+      if (!valid.length) return out;
+      const from = new Date(Math.min(...valid.map(f => Date.parse(f.kickoffUtc))) - 3_600_000);
+      const to = new Date(Math.max(...valid.map(f => Date.parse(f.kickoffUtc))) + 3_600_000);
+      const keys = [...new Set(valid.filter(f => f.provider === this.name && f.competition.providerId).map(f => f.competition.providerId))];
+      // Für Fremd-Provider-Events alle konfigurierten Sport-Keys prüfen (Fixture-Matching erst nach Abruf).
+      // DB-Ansicht fixturesForEvents() führt keine Provider-Competition-ID mit; dann die freigegebenen Sport-Keys verwenden.
+      const sportsAll = valid.some(f => f.provider !== this.name) || !keys.length ? await this.sportKeys() : keys;
+      // Nächste Anstöße zuerst; Budget VOR dem ersten kostenpflichtigen Abruf prüfen
+      const firstKick = (sp: string) => Math.min(...valid.filter(f => f.competition.providerId === sp).map(f => Date.parse(f.kickoffUtc)), Infinity);
+      const sports = [...sportsAll].sort((a, b) => firstKick(a) - firstKick(b) || a.localeCompare(b));
+      const cost = this.oddsCost();
+      const avail = this.creditsAvailable();
+      const affordable = Math.max(0, Math.floor(avail.credits / cost));
+      for (const sp of sports.slice(affordable)) this.report.skippedSportKeys.push({ key: sp, reason: `Budget: ${cost} Credits je Abruf, verfügbar ${avail.credits} (${avail.limitedBy})` });
+      if (!affordable && sports.length) throw new QuotaExhaustedError(this.name, `${this.name}: kein Quotenabruf – ${cost} Credits nötig, verfügbar ${avail.credits} (${avail.limitedBy})`);
+      for (const sport of sports.slice(0, affordable)) await this.eventsWithOdds(sport, from, to);
+      const wanted = new Set(valid.filter(f => f.provider === this.name).map(f => f.providerEventId));
+      const all = valid.some(f => f.provider !== this.name);
+      const selected = [...this.lastEvents.values()].filter(({ e }) => all || wanted.has(e.id));
+      for (const { e, fetchedAt, fromCache } of selected) {
+        const qs = convertOaEvent(e, fetchedAt, { onlyOuLine: OU_LINE }).map(q => ({ ...q, fromCache }));
+        if (qs.some(q => q.market === '1X2')) this.report.markets['1X2'].events++;
+        if (qs.some(q => q.market === 'OU')) this.report.markets.OU.events++;
+        out.push(...qs);
+      }
+      if (this.o.includeBtts) out.push(...await this.bttsLimited(selected.map(s => s.e)));
+      for (const m of ['1X2', 'OU'] as MarketId[]) if (!this.report.markets[m].events) this.report.markets[m].reason = selected.length ? 'vom Provider für diese Spiele nicht geliefert' : 'keine Spiele';
+      return out;
+    } finally {
+      // Keine Quoten über den Lauf hinaus im Speicher halten (nie als "aktuell" wiederverwenden)
+      this.lastEvents.clear();
     }
-    if (this.o.includeBtts) out.push(...await this.bttsLimited(selected.map(s => s.e)));
-    for (const m of ['1X2', 'OU'] as MarketId[]) if (!this.report.markets[m].events) this.report.markets[m].reason = selected.length ? 'vom Provider für diese Spiele nicht geliefert' : 'keine Spiele';
-    return out;
   }
 
   /**
diff --git a/backend/src/providers/types.ts b/backend/src/providers/types.ts
index bd4e4de..f2a062a 100644
--- a/backend/src/providers/types.ts
+++ b/backend/src/providers/types.ts
@@ -87,6 +87,11 @@ export interface FootballDataProvider {
   lastGames?(teamProviderId: string): Promise<ProviderFixture[]>;
   headToHead?(teamA: string, teamB: string): Promise<ProviderFixture[]>;
   matchDetails?(providerEventId: string): Promise<ProviderFixture | null>;
+  /**
+   * v0.4.0: Ergebnisse gebündelt je Wettbewerb (ein Abruf je Wettbewerb statt je Spiel).
+   * competitionProviderId = Wettbewerbs-ID dieses Providers (The Odds API: sport_key).
+   */
+  resultsFor?(items: { providerEventId: string; competitionProviderId: string | null; kickoffUtc: string }[]): Promise<ProviderFixture[]>;
   matchStatistics?(providerEventId: string): Promise<ProviderMatchStat[]>;
   lineups?(providerEventId: string): Promise<ProviderLineup[]>;
   teamStatistics?(teamProviderId: string, fromDate: string): Promise<ProviderTeamStats[]>;
diff --git a/backend/src/scheduler.ts b/backend/src/scheduler.ts
index 8772fe4..c14c777 100644
--- a/backend/src/scheduler.ts
+++ b/backend/src/scheduler.ts
@@ -1,6 +1,8 @@
 /**
  * Scheduler im Backend-Prozess (unabhängig von einem offenen Chat oder Browser).
- * - Stündlicher Sync (Intervall konfigurierbar, mindestens 15 min), Abrechnung 30 min, Backtest täglich 04:00 Ortszeit, Bereinigung täglich
+ * - Kostenlose Spielsuche 'discovery' (THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES, Standard 30 min) und kostenpflichtiger
+ *   Quoten-/Analyselauf 'hourly_sync' (THE_ODDS_API_ODDS_INTERVAL_MINUTES, Standard 60 min, mind. 15) getrennt (v0.4.0)
+ * - Abrechnung 30 min, Validierung (Datenqualität → Backtest) täglich 04:00 Ortszeit, Bereinigung täglich
  * - DB-Lock mit kurzer Ablaufzeit (LOCK_TTL) und Heartbeat: der laufende Job verlängert sein Lock jede Minute.
  *   Stirbt der Prozess, läuft das Lock nach LOCK_TTL ab → keine dauerhafte Blockade.
  * - Abgestürzte Läufe (status 'running' ohne Heartbeat) werden beim Start und bei jedem Tick als 'interrupted' markiert.
@@ -9,12 +11,19 @@
  * - Kein Überholen: derselbe Job läuft nie zweimal gleichzeitig (Prozess-Set + DB-Lock).
  */
 import type { App } from './app.js';
-import { BacktestingEngine } from './engines/backtest.js';
+import { runValidation } from './engines/validation.js';
 import { SubscriptionService } from './subscriptions.js';
 import { Settlement } from './engines/performance.js';
 import { nowIso, sha } from './util/core.js';
 import { log, logError } from './util/log.js';
 
+/** Strategie/Mindest-EV/Gewicht aus den Systemeinstellungen, damit der Backtest dieselben Regeln wie der Live-Betrieb nutzt. */
+export function validationSettings(app: App) {
+  const s = app.db.get<{ min_ev: number | null; strategy: string | null; model_weight: number | null }>('SELECT min_ev, strategy, model_weight FROM system_settings WHERE id = 1');
+  return { minEv: s?.min_ev ?? app.cfg.analysis.minEv, strategy: (s?.strategy ?? app.cfg.analysis.strategy) as App['cfg']['analysis']['strategy'], modelWeight: s?.model_weight ?? null,
+    maxRecommendations: app.cfg.analysis.maxRecommendations, timezone: app.cfg.timezone };
+}
+
 export const LOCK_TTL_MIN = 10;
 export const HEARTBEAT_MS = 60_000;
 export const STALE_RUN_MIN = 15;
@@ -30,9 +39,15 @@ export class Scheduler {
 
   constructor(private app: App) {
     this.jobs = [
+      // v0.4.0: kostenlose Spielsuche und kostenpflichtiger Quoten-/Analyselauf mit getrennten Intervallen
+      { name: 'discovery', intervalMin: app.cfg.theOddsApi.discoveryIntervalMinutes, run: now => app.sync.discover(now) },
       { name: 'hourly_sync', intervalMin: app.cfg.analysis.syncIntervalMinutes, run: now => app.sync.run(now) },
       { name: 'settlement', intervalMin: 30, run: async now => new Settlement(app.db).run(now) },
-      { name: 'backtest', intervalMin: 1440, dailyAtHour: 4, run: async () => new BacktestingEngine(app.db).run({ includeMock: app.providers.isMock }) },
+      // v0.4.0: derselbe Weg wie die manuelle Validierung (Datenqualitätsprüfung, Blocker je Wettbewerb, Bericht)
+      { name: 'backtest', intervalMin: 1440, dailyAtHour: 4, run: async () => {
+        const r = runValidation(app.db, { includeMock: app.providers.isMock, ...validationSettings(app) });
+        return { validationId: r.id, status: r.status, backtestRunId: r.backtestRunId, reasons: r.reasons.slice(0, 20) };
+      } },
       { name: 'cleanup', intervalMin: 1440, run: async now => ({ cache: app.queue.purgeExpiredCache(), requests: app.db.run("DELETE FROM api_requests WHERE created_at < ?", new Date(now.getTime() - 35 * 86_400_000).toISOString()).changes,
         sessions: app.db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso(now)).changes,
         // v0.3.0: abgelaufene Abos und Aufbewahrungsfrist der Zahlungsbelege
diff --git a/backend/src/server.ts b/backend/src/server.ts
index 9e1cff5..a68e888 100644
--- a/backend/src/server.ts
+++ b/backend/src/server.ts
@@ -19,6 +19,8 @@ import { controlledSync } from './engines/diagnostic.js';
 import { oddsApiStatus, testOddsApiConnection } from './engines/oddsApiStatus.js';
 import { historicalDataQuality } from './engines/dataQuality.js';
 import { runValidation } from './engines/validation.js';
+import { validationSettings } from './scheduler.js';
+import { competitionCoverage } from './engines/coverage.js';
 import { SubscriptionService } from './subscriptions.js';
 import { json } from './db/db.js';
 import { EdgeAnalyst } from './engines/analyst.js';
@@ -298,7 +300,8 @@ export function createServer(app: App, scheduler: Scheduler | null, opts: Server
     return x.map(Number).filter(n => known.has(n));
   };
 
-  route('POST', '/api/backtest/run', 'admin', async () => (scheduler ? scheduler.runJob('backtest') : bt.run({ includeMock: app.providers.isMock })), { limit: jobLimit });
+  // v0.4.0: auch ohne Scheduler über den Validierungsablauf (Datenqualitätsprüfung), nie direkt über die Backtest-Engine
+  route('POST', '/api/backtest/run', 'admin', async () => (scheduler ? scheduler.runJob('backtest') : (r => ({ validationId: r.id, status: r.status, backtestRunId: r.backtestRunId }))(runValidation(db, { includeMock: app.providers.isMock, ...validationSettings(app) }))), { limit: jobLimit });
 
   route('GET', '/api/admin/diagnostics', 'admin', ({ now }) => {
     const today = now.toISOString().slice(0, 10);
@@ -329,10 +332,12 @@ export function createServer(app: App, scheduler: Scheduler | null, opts: Server
     return controlledSync(app, { now, maxEvents, userId: me!.userId, withLock: scheduler ? (fn) => scheduler.withLock('hourly_sync', fn, now) : undefined });
   }, { limit: jobLimit });
   // v0.3.3 – The Odds API: Status (nur aus Konfiguration und DB) und kostenloser Verbindungstest (GET /v4/sports, ein Versuch)
-  route('GET', '/api/admin/providers/theoddsapi', 'admin', ({ now }) => oddsApiStatus(app, now));
+  // v0.4.0: Datengrundlage je Wettbewerb (Spielplan, Quoten, Historie, Teams, Modelle, Validierung je Markt)
+  route('GET', '/api/admin/coverage', 'admin', ({ now }) => competitionCoverage(db, app.cfg, now));
+  route('GET', '/api/admin/providers/theoddsapi', 'admin', ({ now }) => oddsApiStatus(app, now, scheduler?.status(now)));
   route('POST', '/api/admin/providers/theoddsapi/test', 'admin', async ({ me, now }) => {
     const result = await testOddsApiConnection(app, { triggeredBy: `admin:${me!.userId}`, now });
-    return { result, status: oddsApiStatus(app, now) };
+    return { result, status: oddsApiStatus(app, now, scheduler?.status(now)) };
   }, { limit: oddsTestLimit });
   route('GET', '/api/admin/diagnostics/runs', 'admin', () => db.all("SELECT id, kind, started_at, finished_at, status FROM diagnostic_runs ORDER BY id DESC LIMIT 30"));
   route('GET', '/api/admin/diagnostics/runs/:id', 'admin', ({ params }) => {
@@ -364,7 +369,7 @@ export function createServer(app: App, scheduler: Scheduler | null, opts: Server
   // Historische Validierung (V3)
   route('GET', '/api/admin/data-quality', 'admin', () => historicalDataQuality(db, { includeMock: app.providers.isMock }));
   route('POST', '/api/admin/validation/run', 'admin', async () => {
-    const run = async () => { const r = runValidation(db, { includeMock: app.providers.isMock }); return { id: r.id, status: r.status, reasons: r.reasons, backtestRunId: r.backtestRunId }; };
+    const run = async () => { const r = runValidation(db, { includeMock: app.providers.isMock, ...validationSettings(app) }); return { id: r.id, status: r.status, reasons: r.reasons, backtestRunId: r.backtestRunId }; };
     if (!scheduler) return run();
     const r = await scheduler.withLock('backtest', run);
     if (!r.started) throw new AppError('busy', 'Ein Backtest läuft bereits', 409);
@@ -377,7 +382,7 @@ export function createServer(app: App, scheduler: Scheduler | null, opts: Server
   });
   route('POST', '/api/admin/jobs/:name/run', 'admin', async ({ params }) => {
     if (!scheduler) throw new AppError('unavailable', 'Scheduler deaktiviert', 409);
-    const name = v.oneOf(params.name, 'job', ['hourly_sync', 'settlement', 'backtest', 'cleanup'] as const);
+    const name = v.oneOf(params.name, 'job', ['discovery', 'hourly_sync', 'settlement', 'backtest', 'cleanup'] as const);
     return scheduler.runJob(name);
   }, { limit: jobLimit });
   route('POST', '/api/admin/providers/:name/resume', 'admin', ({ params, me }) => {
diff --git a/backend/test/helpers.ts b/backend/test/helpers.ts
index 02776c5..28978ff 100644
--- a/backend/test/helpers.ts
+++ b/backend/test/helpers.ts
@@ -48,7 +48,7 @@ import type { Db as DbT } from '../src/db/db.js';
  * Synthetische (NICHT echte) Liga mit bekannter Wahrheit in der DB – nur um die Backtest-Logik zu prüfen.
  * Marktquoten: pre_closing = Wahrheit + Rauschen + Marge (24 h vor Anstoß), closing = optional manipulierbar.
  */
-export function insertSyntheticLeague(db: DbT, opts: { teams?: number; seasons?: number; marketNoise?: number; withOdds?: boolean; closingOdds?: number | null; seed?: string } = {}) {
+export function insertSyntheticLeague(db: DbT, opts: { teams?: number; seasons?: number; marketNoise?: number; withOdds?: boolean; closingOdds?: number | null; seed?: string; spacingHours?: number; providerId?: string; name?: string } = {}) {
   const T = opts.teams ?? 16, seasons = opts.seasons ?? 4;
   const r = rng(opts.seed ?? 'synthetic');
   const att = Array.from({ length: T }, () => 0.65 + r() * 0.7), def = Array.from({ length: T }, () => 0.65 + r() * 0.7);
@@ -59,11 +59,11 @@ export function insertSyntheticLeague(db: DbT, opts: { teams?: number; seasons?:
     for (let s = 0; s < seasons; s++) for (let a = 0; a < T; a++) for (let b = 0; b < T; b++) {
       if (a === b) continue;
       const lh = 1.15 * att[a] * def[b] * 1.25, la = 1.15 * att[b] * def[a];
-      const kickoff = new Date(start + day++ * 6 * 3_600_000).toISOString();
+      const kickoff = new Date(start + day++ * (opts.spacingHours ?? 6) * 3_600_000).toISOString();
       const hg = pois(lh), ag = pois(la);
-      const id = `syn-${s}-${a}-${b}`;
-      const m = match.upsertFixture({ provider: 'synthetic-test', providerEventId: id, competition: { providerId: 'syn', name: 'Synthetische Testliga', countryCode: 'XX', season: String(2021 + s) },
-        home: { providerId: 'syn:' + a, name: `Syn Team ${a}` }, away: { providerId: 'syn:' + b, name: `Syn Team ${b}` }, kickoffUtc: kickoff, status: 'finished', homeGoals: hg, awayGoals: ag });
+      const id = `${opts.providerId ?? 'syn'}-${s}-${a}-${b}`;
+      const m = match.upsertFixture({ provider: 'synthetic-test', providerEventId: id, competition: { providerId: opts.providerId ?? 'syn', name: opts.name ?? 'Synthetische Testliga', countryCode: 'XX', season: String(2021 + s) },
+        home: { providerId: (opts.providerId ?? 'syn') + ':' + a, name: `${opts.name ?? 'Syn'} Team ${a}` }, away: { providerId: (opts.providerId ?? 'syn') + ':' + b, name: `${opts.name ?? 'Syn'} Team ${b}` }, kickoffUtc: kickoff, status: 'finished', homeGoals: hg, awayGoals: ag });
       n++;
       if (opts.withOdds === false) continue;
       const truth = probsFromLambdas(lh, la, -0.08);
diff --git a/backend/test/pipeline.test.ts b/backend/test/pipeline.test.ts
index 84afe0a..16340a9 100644
--- a/backend/test/pipeline.test.ts
+++ b/backend/test/pipeline.test.ts
@@ -37,8 +37,11 @@ test('End-to-End (Mock): Discovery → Quoten → Prognose → Value → Top 5 
   assert.equal(sig.model_weight, 0.35, 'Default-Gewicht BALANCED');
 });
 
-test('Idempotenz: zweiter Lauf zur selben Zeit erzeugt keine doppelten Snapshots, Prognosen oder Signale', async () => {
+test('Idempotenz: zweiter Lauf zur selben Zeit mit unveränderten Eingaben erzeugt keine doppelten Snapshots, Prognosen oder Signale', async () => {
   const app = await mockApp();
+  // v0.4.0: Der Mock lädt je Lauf bis zu 40 weitere xG-Statistiken nach. Das IST eine Eingabeänderung und erzeugt
+  // seit der Cache-Korrektur zu Recht eine neue Prognose. Für die Idempotenz werden die Eingaben hier konstant gehalten.
+  (app.providers.fixtures[0].capabilities as { matchStats: boolean }).matchStats = false;
   await app.sync.run(ANCHOR);
   const count = () => ({
     snaps: app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM odds_snapshots')!.n,
@@ -52,6 +55,16 @@ test('Idempotenz: zweiter Lauf zur selben Zeit erzeugt keine doppelten Snapshots
   assert.deepEqual(count(), a);
 });
 
+test('v0.4.0: neu geladene xG-Statistiken (geänderte Eingaben) erzeugen eine neue Prognose statt der alten', async () => {
+  const app = await mockApp();
+  await app.sync.run(ANCHOR);
+  const preds = app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM predictions')!.n;
+  const stats = app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM match_statistics')!.n;
+  await app.sync.run(ANCHOR);
+  assert.ok(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM match_statistics')!.n > stats, 'Testvoraussetzung: neue Statistiken geladen');
+  assert.ok(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM predictions')!.n > preds, 'neue Eingaben → neue Prognosen');
+});
+
 test('Quoten-Snapshots sind unveränderlich', async () => {
   const app = await mockApp();
   await app.sync.run(ANCHOR);
diff --git a/backend/test/v030_api_pilot.test.ts b/backend/test/v030_api_pilot.test.ts
index 2cb9b09..9e25c3f 100644
--- a/backend/test/v030_api_pilot.test.ts
+++ b/backend/test/v030_api_pilot.test.ts
@@ -121,11 +121,14 @@ test('V1: Credit-Grenzen bleiben wirksam; jeder Abruf wird ohne Schlüssel proto
   assert.equal(c.q.usedThisMonth('theoddsapi'), 0, 'Spielsuche gratis');
   const first = fixtures[0];
   assert.ok(first);
-  await assert.rejects(p.oddsForFixtures([
+  // v0.4.0: Budget wird VOR dem ersten kostenpflichtigen Abruf geprüft – der zweite Wettbewerb wird gar nicht erst angefragt
+  await p.oddsForFixtures([
     { ...first, competition: { ...first.competition, providerId: 'soccer_epl' } },
     { ...first, providerEventId: 'other-event', competition: { ...first.competition, providerId: 'soccer_spain_la_liga' } },
-  ]), /Monatsbudget/);
-  assert.equal(c.calls.filter(x => new URL(x).pathname.endsWith('/odds')).length, 1, 'zweiter Quotenabruf wird wegen Budget gestoppt');
+  ]);
+  assert.equal(c.calls.filter(x => new URL(x).pathname.endsWith('/odds')).length, 1, 'zweiter Quotenabruf wird wegen Budget nicht gesendet');
+  assert.ok(p.lastRunReport().skippedSportKeys.some(k => k.key === 'soccer_spain_la_liga' && /Budget/.test(k.reason) && /Monatsbudget/.test(k.reason)), JSON.stringify(p.lastRunReport().skippedSportKeys));
+  await assert.rejects(p.oddsForFixtures([{ ...first, competition: { ...first.competition, providerId: 'soccer_epl' } }]), /kein Quotenabruf/, 'Budget erschöpft → kein Abruf');
   assert.equal(c.q.usedThisMonth('theoddsapi'), 4);
   const log = c.q.recentRequests();
   assert.ok(log.length >= 1);
diff --git a/backend/test/v033_odds_api.test.ts b/backend/test/v033_odds_api.test.ts
index f1d858d..2267e47 100644
--- a/backend/test/v033_odds_api.test.ts
+++ b/backend/test/v033_odds_api.test.ts
@@ -310,7 +310,7 @@ test('v0.3.3 #9: Kostenvoranschlag über Budget → kein Abruf; Anbieter-Restcre
   // auch direkt über den automatischen Sync: Queue stoppt VOR dem Senden
   const s = await c.app.sync.run(new Date(now));
   assert.equal(c.calls.filter(u => u.includes('/odds')).length, 0);
-  assert.ok(s.errors.some(e => /nur noch 1 Credits/.test(e)), s.errors.join(' | '));
+  assert.ok(s.errors.some(e => /verfügbar 1 \(Anbieter-Restcredits/.test(e)), s.errors.join(' | '));
   // d) Monatsbudget nach x-requests-last
   const d = liveApp(standardRoutes(now, p => p.endsWith('/odds') ? { body: uclEvents(now), headers: quotaHeaders('3') } : null), { THE_ODDS_API_MONTHLY_BUDGET: '4' });
   await testOddsApiConnection(d.app, { triggeredBy: 'test' });
diff --git a/backend/test/v040_p1_persistence.test.ts b/backend/test/v040_p1_persistence.test.ts
new file mode 100644
index 0000000..7c7ba61
--- /dev/null
+++ b/backend/test/v040_p1_persistence.test.ts
@@ -0,0 +1,118 @@
+/**
+ * v0.4.0 – Priorität 1: Regressionstests für Signalpersistenz und Prognose-Cache.
+ * Diese Tests wurden VOR der Korrektur geschrieben und schlugen mit v0.3.4 fehl (siehe CHANGES_v0.4.0.md).
+ */
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { ANCHOR, mockApp } from './helpers.js';
+import { ValueBettingEngine, type Signal, type StoredSignal, type ValueSettings } from '../src/engines/value.js';
+import { PredictionEngine } from '../src/engines/prediction/index.js';
+import { OddsStore } from '../src/engines/odds.js';
+
+const base: ValueSettings = { minEv: 0.05, strategy: 'BALANCED', oddsMaxAgeMinutes: 90, preferredBookmakers: [], modelValidated: false, isMock: true };
+
+async function setup() {
+  const app = await mockApp();
+  await app.sync.run(ANCHOR);
+  // Ein Spiel mit mindestens einem Signal, das einen Marktpreis ohne den besten Buchmacher hat
+  const row = app.db.get<{ event_id: number }>(`SELECT event_id FROM value_signals WHERE active = 1 AND novig_prob IS NOT NULL AND best_snapshot_id IS NOT NULL ORDER BY id LIMIT 1`)!;
+  assert.ok(row, 'Signal mit Marktreferenz erwartet');
+  const pred = new PredictionEngine(app.db).predictEvent(row.event_id, ANCHOR)!;
+  const v = new ValueBettingEngine(app.db);
+  return { app, v, pred, eventId: row.event_id };
+}
+const active = (app: Awaited<ReturnType<typeof mockApp>>, s: Signal) =>
+  app.db.get<StoredSignal>(`SELECT * FROM value_signals WHERE event_id = ? AND market_id = ? AND selection_id = ? AND ${s.line == null ? 'line IS NULL' : 'line = ' + s.line} AND active = 1`, s.eventId, s.market, s.selection)!;
+
+test('P1: identische Neuberechnung erzeugt keine neue Signalversion', async () => {
+  const { app, v, pred } = await setup();
+  v.persist(v.evaluate(pred, base, ANCHOR), ANCHOR);
+  const before = app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM value_signals')!.n;
+  const ch = v.persist(v.evaluate(pred, base, ANCHOR), ANCHOR);
+  assert.equal(ch.length, 0, 'keine Änderung gemeldet');
+  assert.equal(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM value_signals')!.n, before);
+});
+
+test('P1: geändertes Modellgewicht → gespeicherte decision_prob/EV entsprechen der neuen Berechnung', async () => {
+  const { app, v, pred } = await setup();
+  v.persist(v.evaluate(pred, { ...base, modelWeight: 0.35 }, ANCHOR), ANCHOR);
+  const next = v.evaluate(pred, { ...base, modelWeight: 0.6 }, ANCHOR);
+  v.persist(next, ANCHOR);
+  for (const s of next.filter(x => x.decisionProb != null)) {
+    const st = active(app, s);
+    assert.ok(Math.abs(st.decision_prob! - s.decisionProb!) < 1e-12, `${s.market}/${s.selection}: gespeichert ${st.decision_prob}, berechnet ${s.decisionProb}`);
+    assert.ok(Math.abs(st.ev! - s.ev!) < 1e-12);
+    assert.equal(st.model_weight, 0.6);
+  }
+});
+
+test('P1: geänderte Strategie → neue Signalversion mit neuer Untergrenze', async () => {
+  const { app, v, pred } = await setup();
+  v.persist(v.evaluate(pred, base, ANCHOR), ANCHOR);
+  const next = v.evaluate(pred, { ...base, strategy: 'CONSERVATIVE', modelWeight: 0.35 }, ANCHOR);
+  v.persist(next, ANCHOR);
+  for (const s of next.filter(x => x.probLow != null)) {
+    const st = active(app, s);
+    assert.ok(Math.abs(st.prob_low! - s.probLow!) < 1e-12, `${s.market}/${s.selection}: prob_low ${st.prob_low} vs ${s.probLow}`);
+  }
+});
+
+test('P1: geänderte Referenzquote bei unveränderter bester Quote → neue novig_prob gespeichert', async () => {
+  const { app, v, pred, eventId } = await setup();
+  const first = v.evaluate(pred, base, ANCHOR);
+  v.persist(first, ANCHOR);
+  const s0 = first.find(s => s.novigProb != null && s.bestBookmakerId)!;
+  // Neuer Snapshot eines ANDEREN Buchmachers mit klar schlechteren Preisen (bleibt nicht der beste)
+  const views = new OddsStore(app.db).latestPerBookmaker(eventId, s0.market, s0.line);
+  const other = views.find(x => x.bookmakerId !== s0.bestBookmakerId)!;
+  const prices = Object.fromEntries(Object.entries(other.prices).map(([k, p]) => [k, +(Math.max(1.01, (p as number) * (k === s0.selection ? 0.9 : 1.08))).toFixed(2)]));
+  new OddsStore(app.db).save(eventId, { provider: 'mock', providerEventId: 'x', bookmakerProviderId: other.bookmakerId, bookmakerName: other.bookmakerId, market: s0.market, line: s0.line,
+    prices, marketStatus: 'open', retrievedAt: new Date(ANCHOR.getTime() + 60_000).toISOString(), sourceTimestamp: null, snapshotKind: 'live' }, [], true);
+  const now2 = new Date(ANCHOR.getTime() + 120_000);
+  const next = v.evaluate(pred, base, now2);
+  const s1 = next.find(s => s.market === s0.market && s.selection === s0.selection)!;
+  assert.equal(s1.bestSnapshotId, s0.bestSnapshotId, 'beste Quote unverändert (Testvoraussetzung)');
+  assert.notEqual(s1.novigProb, s0.novigProb, 'Marktreferenz hat sich geändert (Testvoraussetzung)');
+  v.persist(next, now2);
+  const st = active(app, s1);
+  assert.ok(Math.abs(st.novig_prob! - s1.novigProb!) < 1e-12, `gespeichert ${st.novig_prob}, berechnet ${s1.novigProb}`);
+  assert.ok(Math.abs(st.decision_prob! - s1.decisionProb!) < 1e-12);
+});
+
+test('P1: eingefrorene Performance-Einträge bleiben bei Neuberechnung unverändert', async () => {
+  const { app, v, pred } = await setup();
+  const before = app.db.all('SELECT * FROM prediction_outcomes ORDER BY id');
+  v.persist(v.evaluate(pred, { ...base, modelWeight: 0.9 }, ANCHOR), ANCHOR);
+  app.sync.report(ANCHOR);
+  assert.deepEqual(app.db.all('SELECT * FROM prediction_outcomes ORDER BY id'), before);
+});
+
+test('P1: korrigiertes historisches Ergebnis → neuer Fit und neue, konsistent gespeicherte Prognose', async () => {
+  const app = await mockApp();
+  await app.sync.run(ANCHOR);
+  const ev = app.db.get<{ id: number; competition_id: number }>(`SELECT id, competition_id FROM events WHERE status = 'scheduled' AND kickoff_utc > ? ORDER BY kickoff_utc LIMIT 1`, ANCHOR.toISOString())!;
+  const pe = new PredictionEngine(app.db);
+  const a = pe.predictEvent(ev.id, ANCHOR)!;
+  // Ein abgeschlossenes Spiel des Heimteams wird nachträglich korrigiert (z. B. Datenfehler beim Provider)
+  const e = app.db.get<{ home_team_id: number }>('SELECT home_team_id FROM events WHERE id = ?', ev.id)!;
+  const h = app.db.get<{ id: number; home_goals: number }>(`SELECT id, home_goals FROM events WHERE competition_id = ? AND status = 'finished' AND home_team_id = ? ORDER BY kickoff_utc DESC LIMIT 1`, ev.competition_id, e.home_team_id)!;
+  app.db.run('UPDATE events SET home_goals = ? WHERE id = ?', h.home_goals + 4, h.id);
+  const b = pe.predictEvent(ev.id, ANCHOR)!;
+  assert.notDeepEqual(b.ensemble.probs, a.ensemble.probs, 'Prognose muss die Korrektur berücksichtigen');
+  assert.notEqual(b.id, a.id, 'neue Prognose-ID erwartet');
+  const stored = JSON.parse(app.db.get<{ probs: string }>('SELECT probs FROM predictions WHERE id = ?', b.id)!.probs);
+  assert.deepEqual(stored, JSON.parse(JSON.stringify(b.ensemble.probs)), 'gespeicherte und zurückgegebene Prognose stimmen überein');
+});
+
+test('P1: korrigierte xG-Statistik → neuer Fit (Cache-Schlüssel enthält den Datenstand)', async () => {
+  const app = await mockApp();
+  await app.sync.run(ANCHOR);
+  const ev = app.db.get<{ id: number; competition_id: number }>(`SELECT id, competition_id FROM events WHERE status = 'scheduled' AND kickoff_utc > ? ORDER BY kickoff_utc LIMIT 1`, ANCHOR.toISOString())!;
+  const pe = new PredictionEngine(app.db);
+  const k1 = pe.leagueFits(ev.competition_id, ANCHOR.toISOString()).key;
+  const st = app.db.get<{ event_id: number; team_id: number }>(`SELECT s.event_id, s.team_id FROM match_statistics s JOIN events e ON e.id = s.event_id WHERE e.competition_id = ? AND s.stat_key = 'xg' LIMIT 1`, ev.competition_id);
+  assert.ok(st, 'Mock-Daten enthalten xG');
+  app.db.run(`UPDATE match_statistics SET value = value + 1.5 WHERE event_id = ? AND team_id = ? AND stat_key = 'xg'`, st!.event_id, st!.team_id);
+  const k2 = pe.leagueFits(ev.competition_id, ANCHOR.toISOString()).key;
+  assert.notEqual(k2, k1);
+});
diff --git a/backend/test/v040_p2_backtest.test.ts b/backend/test/v040_p2_backtest.test.ts
new file mode 100644
index 0000000..2555ef6
--- /dev/null
+++ b/backend/test/v040_p2_backtest.test.ts
@@ -0,0 +1,172 @@
+/**
+ * v0.4.0 – Priorität 2: Backtest/Live-Konsistenz und marktbezogene Validierung.
+ * Synthetische Daten prüfen nur die LOGIK. Sie sind kein Qualitäts- oder Profitabilitätsnachweis.
+ */
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { ANCHOR, insertSyntheticLeague, memDb, mockApp } from './helpers.js';
+import { BacktestingEngine, DECISION_LEAD_MS, knownAt, RESULT_AVAILABLE_AFTER_MS } from '../src/engines/backtest.js';
+import { combine } from '../src/engines/prediction/ensemble.js';
+import { PredictionEngine } from '../src/engines/prediction/index.js';
+import { decide, type DecisionInput } from '../src/engines/value.js';
+import { selectTop } from '../src/engines/recommendation.js';
+import { runValidation } from '../src/engines/validation.js';
+import { Scheduler } from '../src/scheduler.js';
+import type { HistMatch } from '../src/engines/prediction/history.js';
+import { Repository } from '../src/engines/repository.js';
+
+// Eine größere synthetische Liga (einmal berechnet): 1X2 validierbar, BTTS ohne Quoten
+let big: { db: ReturnType<typeof memDb>; eng: BacktestingEngine; r: ReturnType<BacktestingEngine['run']> } | null = null;
+function bigLeague() {
+  if (big) return big;
+  const db = memDb();
+  insertSyntheticLeague(db, { teams: 20, seasons: 5, marketNoise: 0.12, seed: 'val' });
+  const eng = new BacktestingEngine(db);
+  big = { db, eng, r: eng.run({ refitDays: 90, minMatches: 200 }) };
+  return big;
+}
+
+test('P2: Backtest-Ensemble behält λ und nutzt dieselbe Stichprobengröße wie live (gleiche Unsicherheit)', () => {
+  const db = memDb();
+  insertSyntheticLeague(db, { teams: 14, seasons: 3, seed: 'p2' });
+  const eng = new BacktestingEngine(db);
+  const r = eng.run({ refitDays: 60, minMatches: 200 });
+  const rows = eng.lastRows.filter(x => x.segment === 'holdout');
+  assert.ok(rows.length > 50);
+  let larger = 0;
+  for (const row of rows) {
+    assert.ok(row.outputs.some(o => o.lambdaHome != null), 'λ-Werte vorhanden');
+    const live = combine(row.outputs, r.metrics.weights, Math.min(row.dq.homeGames, row.dq.awayGames));
+    assert.deepEqual(row.ensSd, live.sd, 'Unsicherheit identisch zur Live-Berechnung');
+    // v0.3.4: λ gingen verloren → nur Streuung zwischen den Modellen, n fest 30
+    const old = combine(row.outputs.map(o => ({ model: o.model, available: true, probs: o.probs })), r.metrics.weights, 30);
+    if (live.sd['1X2']!.HOME! > old.sd['1X2']!.HOME! + 1e-9) larger++;
+  }
+  assert.equal(larger, rows.length, 'mit λ ist die Unsicherheit größer als im alten Backtest-Pfad');
+});
+
+test('P2: Informationsstand – laufende Spiele zum Entscheidungszeitpunkt sind nicht bekannt', () => {
+  const T = Date.parse('2025-03-01T18:00:00Z');
+  const iso = (ms: number) => new Date(ms).toISOString();
+  const mk = (id: number, kickMs: number): HistMatch => ({ eventId: id, competitionId: 1, kickoff: iso(kickMs), home: 1, away: 2, hg: 1, ag: 0 });
+  const all = [mk(1, T - 6 * 3_600_000), mk(2, T - 3 * 3_600_000), mk(3, T - 90 * 60_000)]; // #3 läuft zur Entscheidung (T − 60 min) noch
+  const decisionAt = iso(T - DECISION_LEAD_MS);
+  const known = knownAt(all, decisionAt).map(m => m.eventId);
+  assert.deepEqual(known, [1], `bekannt: ${known}`);
+  // Alte Regel ("Anstoß vor Zielspiel") hätte #2 und #3 verwendet
+  assert.equal(all.filter(m => m.kickoff < iso(T)).length, 3);
+  assert.equal(RESULT_AVAILABLE_AFTER_MS, 150 * 60_000);
+});
+
+test('P2: Backtest bei dichtem Spielplan: kein Modell sieht ein Ergebnis, das zur Entscheidung noch nicht vorlag', () => {
+  const db = memDb();
+  insertSyntheticLeague(db, { teams: 12, seasons: 3, spacingHours: 1, seed: 'dense', withOdds: false });
+  const eng = new BacktestingEngine(db);
+  eng.run({ refitDays: 30, minMatches: 200 });
+  const all = eng.lastRows;
+  assert.ok(all.length > 0);
+  const hist = new Repository(db).competitionHistory(all[0].competitionId);
+  for (const row of all.slice(0, 40)) {
+    // Teamspiele in der Datenqualität zählen nur Spiele, deren Ergebnis zur Entscheidung vorlag
+    const home = hist.find(x => x.eventId === row.eventId)!.home;
+    const known = knownAt(hist, row.decisionAt).filter(m => m.home === home || m.away === home).length;
+    const naive = hist.filter(m => m.kickoff < row.kickoff && (m.home === home || m.away === home)).length;
+    assert.equal(row.dq.homeGames, known, 'Teamhistorie nur aus bekannten Ergebnissen');
+    assert.ok(naive >= known);
+  }
+});
+
+test('P2: Wettsimulation = Live-Auswahl: höchstens 1 Wette je Spiel, höchstens 5 je Auswahlfenster', () => {
+  const db = memDb();
+  // 2 h Abstand → 12 Spiele je Tag: das Fensterlimit muss greifen können
+  insertSyntheticLeague(db, { teams: 14, seasons: 3, spacingHours: 2, marketNoise: 0.08, seed: 'p2sel' });
+  const r = new BacktestingEngine(db).run({ refitDays: 60, minMatches: 200 });
+  const b = r.metrics.betting!;
+  assert.ok(b.selection, 'Auswahl wird ausgewiesen');
+  assert.ok(b.selection!.maxBetsPerEvent <= 1, `max je Spiel ${b.selection!.maxBetsPerEvent}`);
+  assert.ok(b.selection!.maxBetsInAWindow <= 5);
+  assert.ok(b.bets <= b.selection!.windows * 5);
+  assert.equal(b.qualifiedSignals - b.selection!.excluded.correlatedSameEvent - b.selection!.excluded.beyondWindowLimit, b.bets);
+  assert.match(b.decisionRule, /BALANCED/);
+  assert.ok(b.oddsTimes && b.oddsTimes.estimatedShare > 0, 'geschätzte Quotenzeitpunkte ausgewiesen');
+  assert.match(b.note, /GESCHÄTZT/);
+});
+
+test('P2: Live und Backtest nutzen dieselbe Entscheidungsregel (Datenqualität, AVOID, Strategie)', () => {
+  const base: DecisionInput = { p: 0.5, sd: 0.02, bestOdds: 2.3, novig: 0.47, strategy: 'BALANCED', minEv: 0.05, dqScore: 80, agreement: 0.9, modelValidated: false, marketEdgeProven: false, isMock: false, freshness: 1, freshBooks: 4, marketRefSource: 'sharp:x' };
+  assert.equal(decide(base).status, 'VALUE');
+  assert.equal(decide({ ...base, dqScore: 50 }).status, 'WATCH', 'Datenqualität unter Mindestwert BALANCED');
+  assert.equal(decide({ ...base, p: 0.65 }).status, 'AVOID', '> 12 Pp. vom Markt');
+  assert.ok(decide({ ...base, strategy: 'CONSERVATIVE' }).probLow < decide(base).probLow, 'Strategie-z wirkt');
+  // STRONG_VALUE nur mit validiertem Modell UND belegtem Mehrwert gegenüber dem Markt
+  const strong = { ...base, p: 0.56, bestOdds: 2.4, novig: 0.5, modelValidated: true };
+  assert.equal(decide({ ...strong, marketEdgeProven: false }).status, 'VALUE');
+  assert.ok(decide({ ...strong, marketEdgeProven: false }).reasons.some(x => /kein statistisch nachgewiesener Mehrwert/.test(x)));
+  assert.equal(decide({ ...strong, marketEdgeProven: true }).status, 'STRONG_VALUE');
+  assert.ok(decide(base).reasons.some(x => /experimentelles Signal/.test(x)), 'UNVALIDATED wird als experimentell bezeichnet');
+  // Auswahl: selectTop liefert je Spiel eine Auswahl, Rang deterministisch
+  const c = [{ id: 1, event_id: 7, ev_low: 0.02, quality_score: 80 }, { id: 2, event_id: 7, ev_low: 0.05, quality_score: 80 }, { id: 3, event_id: 8, ev_low: 0.01, quality_score: 80 }];
+  const top = selectTop(c, 5);
+  assert.deepEqual(top.map(t => t.pick.id), [2, 3]);
+  assert.deepEqual(top[0].correlated.map(x => x.id), [1]);
+});
+
+test('P2: Validierung je Markt – fehlende BTTS-Quoten blockieren 1X2 nicht und validieren BTTS nicht mit', () => {
+  const { r } = bigLeague();
+  const sc = r.metrics.scopes!;
+  const x1 = sc.find(s => s.market === '1X2')!, bt = sc.find(s => s.market === 'BTTS')!;
+  assert.equal(x1.status, 'VALIDATED', JSON.stringify(x1.reasons));
+  assert.equal(bt.status, 'UNVALIDATED');
+  assert.equal(bt.marketEvidence, 'NOT_TESTABLE');
+  assert.ok(bt.reasons.some(x => /Marktquoten/.test(x)));
+  assert.equal(r.metrics.validation.status, 'PARTIAL', 'Gesamt nur teilweise validiert');
+  assert.ok(x1.oddsTimesEstimated, 'geschätzte Quotenzeitpunkte gekennzeichnet');
+});
+
+test('P2: "nicht signifikant schlechter als der Markt" wird nicht als Mehrwert ausgegeben', () => {
+  const { r } = bigLeague();
+  const x1 = r.metrics.scopes!.find(s => s.market === '1X2')!;
+  assert.equal(x1.marketEvidence, 'NOT_WORSE', `${JSON.stringify(x1.blendVsMarket)}`);
+  assert.ok(x1.reasons.some(x => /KEIN Nachweis eines Mehrwerts/.test(x)));
+  assert.ok(!r.metrics.validation.reasons.some(x => /mit Mehrwert gegenüber dem Markt/.test(x)), 'alte Formulierung entfernt');
+});
+
+test('P2: validierte Version gilt nur für geprüfte Wettbewerbe und Märkte', () => {
+  const { db, r } = bigLeague();
+  const comp = r.metrics.scopes![0].competitionId;
+  const pe = new PredictionEngine(db);
+  const a = pe.currentModelVersion(comp);
+  assert.equal(a.status, 'VALIDATED');
+  assert.deepEqual(a.validatedMarkets, ['1X2']);
+  assert.deepEqual(a.marketEdgeMarkets, [], 'kein Mehrwert belegt → STRONG_VALUE gesperrt');
+  assert.ok(a.weights && a.weights['1X2'] && !a.weights.OU && !a.weights.BTTS, 'Gewichte nur für validierte Märkte');
+  // Anderer (ungeprüfter) Wettbewerb: Basisversion, nichts validiert
+  const other = Number(db.run("INSERT INTO competitions (name, region, is_mock) VALUES ('UEFA Champions League', 'europe', 0)").lastInsertRowid);
+  const b = pe.currentModelVersion(other);
+  assert.equal(b.status, 'UNVALIDATED');
+  assert.deepEqual(b.validatedMarkets, []);
+  // Eine alte, global als VALIDATED markierte Version ohne Scope-Einträge wird nicht mehr übernommen
+  db.run("INSERT INTO model_versions (id, description, weights, validation_status, created_at) VALUES ('legacy-global', 'alt', '{}', 'VALIDATED', '2099-01-01T00:00:00Z')");
+  assert.equal(pe.currentModelVersion(other).status, 'UNVALIDATED');
+  assert.equal(pe.currentModelVersion(comp).id, a.id);
+});
+
+test('P2: Scheduler nutzt denselben Validierungsweg mit Datenqualitätsprüfung wie der manuelle Weg', async () => {
+  const app = await mockApp();
+  insertSyntheticLeague(app.db, { teams: 14, seasons: 3, seed: 'sched', providerId: 'schedliga', name: 'Sched Liga' });
+  const comp = app.db.get<{ competition_id: number }>("SELECT competition_id FROM competition_aliases WHERE provider_id = 'schedliga'")!.competition_id;
+  // Doppeltes Spiel → harter Datenqualitätsbefund nur für diese Liga
+  const e = app.db.get<{ home_team_id: number; away_team_id: number; kickoff_utc: string }>('SELECT home_team_id, away_team_id, kickoff_utc FROM events WHERE competition_id = ? LIMIT 1', comp)!;
+  app.db.run("INSERT INTO events (competition_id, home_team_id, away_team_id, kickoff_utc, status, home_goals, away_goals) VALUES (?, ?, ?, ?, 'finished', 1, 1)", comp, e.home_team_id, e.away_team_id, new Date(Date.parse(e.kickoff_utc) + 3_600_000).toISOString());
+  const res = await new Scheduler(app).runJob('backtest', ANCHOR);
+  assert.equal(res.started, true, res.error);
+  const v = app.db.get<{ id: number; report: string }>("SELECT id, report FROM diagnostic_runs WHERE kind = 'validation' ORDER BY id DESC LIMIT 1");
+  assert.ok(v, 'Validierungsbericht des Scheduler-Laufs vorhanden');
+  const rep = JSON.parse(v!.report);
+  assert.ok(rep.dataQuality.competitions.some((c: { competitionId: number; duplicateMatches: unknown[] }) => c.competitionId === comp && c.duplicateMatches.length > 0));
+  const scopes = app.db.all<{ reasons: string; status: string }>('SELECT reasons, status FROM model_scope_validations WHERE competition_id = ?', comp);
+  assert.ok(scopes.length === 3 && scopes.every(s => s.status !== 'VALIDATED' && /Datenqualität: Sched Liga: 1 doppelte Spiele/.test(s.reasons)), JSON.stringify(scopes));
+  // Manueller Weg liefert denselben Befund
+  const manual = runValidation(app.db, { includeMock: true });
+  assert.ok(manual.reasons.some(x => /Sched Liga: 1 doppelte Spiele/.test(x)));
+});
diff --git a/backend/test/v040_p3_odds_api.test.ts b/backend/test/v040_p3_odds_api.test.ts
new file mode 100644
index 0000000..69d7aa9
--- /dev/null
+++ b/backend/test/v040_p3_odds_api.test.ts
@@ -0,0 +1,138 @@
+/**
+ * v0.4.0 – Priorität 3: The Odds API – kostenlose Discovery, budgetgesteuerte Quoten, gebündelte Ergebnisse, Cache-Schlüssel.
+ * Alle Provider-Antworten sind nach der offiziellen v4-Doku NACHGEBAUT (kein Netzwerk, kein echter Schlüssel).
+ * Diese Tests ersetzen KEINEN Live-Test.
+ */
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { buildApp, type App } from '../src/app.js';
+import { ApiQueue } from '../src/api/apiQueue.js';
+import { TheOddsApiProvider, hourWindow } from '../src/providers/theOddsApi.js';
+import { oddsApiStatus, testOddsApiConnection, UCL_SPORT_KEY } from '../src/engines/oddsApiStatus.js';
+import { Scheduler } from '../src/scheduler.js';
+import { loadConfig } from '../src/config.js';
+import { memDb, testConfig } from './helpers.js';
+import { fakeFetcher, oddsEvent, scoresRow } from './fixtures/theOddsApiSamples.js';
+
+const MIN = 60_000, H = 3_600_000;
+const KEY = 'test-odds-key-NOT-REAL-p3';
+const sports = () => [
+  { key: 'soccer_epl', group: 'Soccer', title: 'EPL', active: true, has_outrights: false },
+  { key: UCL_SPORT_KEY, group: 'Soccer', title: 'UEFA Champions League', active: true, has_outrights: false },
+];
+type Routes = Parameters<typeof fakeFetcher>[0];
+function liveApp(routes: Routes, env: Record<string, string> = {}): { app: App; calls: string[] } {
+  const f = fakeFetcher(routes);
+  const app = buildApp(testConfig({ DATA_MODE: 'live', THE_ODDS_API_KEY: KEY, THE_ODDS_API_SPORT_KEYS: `soccer_epl,${UCL_SPORT_KEY}`, ...env }), { db: memDb(), fetcher: f.fetcher, requireOddsConnectionTest: true });
+  return { app, calls: f.calls };
+}
+const path = (u: string) => new URL(u).pathname;
+
+test('P3: Konfiguration – Discovery- und Quotenintervall getrennt, mit Mindestwerten', () => {
+  const c = loadConfig({ THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES: '20', THE_ODDS_API_ODDS_INTERVAL_MINUTES: '120' } as NodeJS.ProcessEnv);
+  assert.equal(c.theOddsApi.discoveryIntervalMinutes, 20);
+  assert.equal(c.analysis.syncIntervalMinutes, 120);
+  const d = loadConfig({ THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES: '1', THE_ODDS_API_ODDS_INTERVAL_MINUTES: '1' } as NodeJS.ProcessEnv);
+  assert.equal(d.theOddsApi.discoveryIntervalMinutes, 10);
+  assert.equal(d.analysis.syncIntervalMinutes, 15);
+  assert.equal(loadConfig({ SYNC_INTERVAL_MINUTES: '90' } as NodeJS.ProcessEnv).analysis.syncIntervalMinutes, 90, 'Altname bleibt gültig');
+});
+
+test('P3: Discovery-Job ist kostenlos – nur /sports und /events, keine /odds- oder /scores-Abrufe, auch ohne Verbindungstest', async () => {
+  const now = Date.now();
+  const { app, calls } = liveApp((p) => {
+    if (p === '/v4/sports') return { body: sports() };
+    if (p.endsWith('/events')) return { body: [oddsEvent({ id: 'd1', sport: 'soccer_epl', title: 'EPL', home: 'Arsenal', away: 'Chelsea', kickoff: now + 20 * H, updatedAt: now })].map(({ bookmakers, ...e }) => e), headers: { 'x-requests-last': '0' } };
+    return { body: [] };
+  }, { THE_ODDS_API_DISCOVERY_INTERVAL_MINUTES: '15' });
+  const sch = new Scheduler(app);
+  const jobs = sch.status(new Date(now));
+  assert.equal(jobs.find(j => j.name === 'discovery')!.intervalMin, 15);
+  assert.equal(jobs.find(j => j.name === 'hourly_sync')!.intervalMin, 60);
+  const r = await sch.runJob('discovery', new Date(now));
+  assert.equal(r.started, true, r.error);
+  assert.ok(calls.length > 0);
+  assert.ok(calls.every(u => /\/v4\/sports(\/[^/]+\/events)?$/.test(path(u))), calls.map(path).join(', '));
+  assert.equal(app.queue.usedThisMonth('theoddsapi'), 0, '0 Credits');
+  assert.equal((r.result as { newEvents: number }).newEvents, 1);
+  assert.ok(app.db.get("SELECT 1 FROM event_mappings WHERE provider = 'theoddsapi' AND provider_event_id = 'd1'"));
+});
+
+test('P3: Cache-Schlüssel mit wechselnden Zeitfenstern – zwei Spielsuchen im Abstand von 2 min nutzen denselben Cache', async () => {
+  const db = memDb(); let clock = new Date('2026-10-12T12:01:00Z'); const urls: string[] = [];
+  const q = new ApiQueue(db, async (url) => { urls.push(url); return { status: 200, headers: { get: () => null }, text: async () => '[]' }; }, () => clock, 0.001);
+  q.register({ provider: 'theoddsapi', dailyBudget: 100, maxConcurrent: 1, minIntervalMs: 0 });
+  const p = new TheOddsApiProvider(q, { apiKey: 'k', baseUrl: 'https://api.the-odds-api.com', regions: 'eu', sportKeys: ['soccer_epl'] });
+  await p.upcomingFixtures(new Date(clock.getTime() + 5 * MIN), new Date(clock.getTime() + 48 * H));
+  clock = new Date('2026-10-12T12:03:00Z');
+  await p.upcomingFixtures(new Date(clock.getTime() + 5 * MIN), new Date(clock.getTime() + 48 * H));
+  assert.equal(urls.length, 1, 'zweiter Aufruf aus dem Cache (vorher sekundengenaues Fenster → immer neuer Schlüssel)');
+  const w = hourWindow(new Date('2026-10-12T12:08:00Z'), new Date('2026-10-14T12:03:00Z'));
+  assert.equal(w.from.toISOString(), '2026-10-12T12:00:00.000Z');
+  assert.equal(w.to.toISOString(), '2026-10-14T13:00:00.000Z');
+  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM api_cache')!.n, 1, 'kein Anwachsen des Caches mit neuen Schlüsseln');
+});
+
+test('P3: lastEvents – begonnene oder außerhalb des Fensters liegende Spiele aus (gecachten) Quotenantworten werden verworfen', async () => {
+  const db = memDb(); const clock = new Date('2026-10-12T12:00:00Z');
+  const t = clock.getTime();
+  const body = [
+    oddsEvent({ id: 'ok', sport: 'soccer_epl', title: 'EPL', home: 'A', away: 'B', kickoff: t + 5 * H, updatedAt: t - MIN }),
+    oddsEvent({ id: 'started', sport: 'soccer_epl', title: 'EPL', home: 'C', away: 'D', kickoff: t - 30 * MIN, updatedAt: t - MIN }),
+    oddsEvent({ id: 'far', sport: 'soccer_epl', title: 'EPL', home: 'E', away: 'F', kickoff: t + 30 * H, updatedAt: t - MIN }),
+  ];
+  const q = new ApiQueue(db, async () => ({ status: 200, headers: { get: (n: string) => n === 'x-requests-last' ? '2' : null }, text: async () => JSON.stringify(body) }), () => clock, 0.001);
+  q.register({ provider: 'theoddsapi', dailyBudget: 100, maxConcurrent: 1, minIntervalMs: 0, costHeader: 'x-requests-last' });
+  const p = new TheOddsApiProvider(q, { apiKey: 'k', baseUrl: 'https://api.the-odds-api.com', regions: 'eu', sportKeys: ['soccer_epl'] });
+  // Fremd-Provider-Fixture → alle Spiele der Antwort kämen in Frage (Fuzzy-Matching erst danach)
+  const qs = await p.oddsForFixtures([{ provider: 'highlightly', providerEventId: 'x', competition: { providerId: '', name: 'EPL' }, home: { providerId: '', name: 'A' }, away: { providerId: '', name: 'B' }, kickoffUtc: new Date(t + 5 * H).toISOString(), status: 'scheduled' }]);
+  assert.deepEqual([...new Set(qs.map(x => x.providerEventId))], ['ok']);
+});
+
+test('P3: Ergebnisse gebündelt – ein /scores-Abruf je Wettbewerb mit offenen Spielen, keiner für ältere oder fremde Wettbewerbe', async () => {
+  const now = Date.now();
+  const ev = (id: string, k: number) => ({ id, sport_key: 'soccer_epl', commence_time: new Date(k).toISOString(), home_team: 'H' + id, away_team: 'A' + id });
+  const recent1 = ev('r1', now - 5 * H), recent2 = ev('r2', now - 6 * H), old = ev('o1', now - 5 * 86_400_000);
+  const { app, calls } = liveApp((p) => {
+    if (p === '/v4/sports') return { body: sports() };
+    if (p === '/v4/sports/soccer_epl/scores') return { body: [scoresRow(recent1, 2, 1, true), scoresRow(recent2, 0, 0, true)], headers: { 'x-requests-last': '2' } };
+    if (p.endsWith('/events')) return { body: [] };
+    if (p.endsWith('/odds')) return { body: [] };
+    return null;
+  });
+  await testOddsApiConnection(app, { triggeredBy: 'test' });
+  // drei offene Spiele (zwei innerhalb von 3 Tagen) im Wettbewerb soccer_epl
+  for (const e of [recent1, recent2, old]) {
+    app.db.run('INSERT OR IGNORE INTO competitions (id, name, is_mock) VALUES (900, \'EPL\', 0)');
+    app.db.run("INSERT OR IGNORE INTO competition_aliases (competition_id, provider, provider_id, alias_name) VALUES (900, 'theoddsapi', 'soccer_epl', 'EPL')");
+    const h = Number(app.db.run('INSERT INTO teams (name, norm_name) VALUES (?, ?)', e.home_team, e.home_team.toLowerCase()).lastInsertRowid);
+    const a = Number(app.db.run('INSERT INTO teams (name, norm_name) VALUES (?, ?)', e.away_team, e.away_team.toLowerCase()).lastInsertRowid);
+    const id = Number(app.db.run("INSERT INTO events (competition_id, home_team_id, away_team_id, kickoff_utc, status) VALUES (900, ?, ?, ?, 'scheduled')", h, a, e.commence_time).lastInsertRowid);
+    app.db.run("INSERT INTO provider_events (provider, provider_event_id, raw_home, raw_away, raw_competition, kickoff_utc, fetched_at) VALUES ('theoddsapi', ?, ?, ?, 'EPL', ?, ?)", e.id, e.home_team, e.away_team, e.commence_time, new Date().toISOString());
+    app.db.run("INSERT INTO event_mappings (event_id, provider, provider_event_id, confidence, method) VALUES (?, 'theoddsapi', ?, 1, 'test')", id, e.id);
+  }
+  const s = await app.sync.run(new Date(now));
+  const scoreCalls = calls.filter(u => path(u).endsWith('/scores'));
+  assert.equal(scoreCalls.length, 1, `genau ein gebündelter Abruf: ${scoreCalls.map(path).join(', ')} · ${s.errors.join(' | ')}`);
+  assert.equal(path(scoreCalls[0]), '/v4/sports/soccer_epl/scores');
+  const st = app.db.all<{ status: string; home_goals: number | null }>("SELECT e.status, e.home_goals FROM events e WHERE e.competition_id = 900 ORDER BY kickoff_utc DESC");
+  assert.deepEqual(st.map(x => x.status), ['finished', 'finished', 'scheduled'], 'Ergebnisse übernommen; >3 Tage altes Spiel ohne Abruf');
+});
+
+test('P3: Verbindungstest belegt keine Quoten/Prognosen; Admin-Status zeigt Belege, letzten HTTP-Status und Zeitplan getrennt', async () => {
+  const now = Date.now();
+  const { app } = liveApp((p) => p === '/v4/sports' ? { body: sports(), headers: { 'x-requests-remaining': '500', 'x-requests-used': '0', 'x-requests-last': '0' } } : null);
+  await testOddsApiConnection(app, { triggeredBy: 'test' });
+  const sch = new Scheduler(app);
+  const st = oddsApiStatus(app, new Date(now), sch.status(new Date(now)));
+  assert.equal(st.connection, 'CONNECTED');
+  assert.equal(st.verification.connection.verified, true);
+  assert.equal(st.verification.odds.verified, false, 'kostenloser Test ist KEIN Quoten-Nachweis');
+  assert.equal(st.verification.predictions.verified, false);
+  assert.match(st.verification.odds.note, /NOT VERIFIED/);
+  assert.match(st.verification.connection.note, /KEINE Quoten/);
+  assert.equal(st.lastHttp!.endpoint, '/v4/sports'); assert.equal(st.lastHttp!.status, 200); assert.equal(st.lastHttp!.costCredits, 0);
+  assert.ok(st.schedule?.discovery && st.schedule.odds, 'nächste geplante Läufe');
+  assert.equal(st.schedule!.odds!.intervalMin, 60);
+  assert.equal(st.lastSuccessfulFetchAt, null, 'kein erfolgreicher Quotenabruf');
+});
diff --git a/backend/test/v040_p4_coverage.test.ts b/backend/test/v040_p4_coverage.test.ts
new file mode 100644
index 0000000..07bf743
--- /dev/null
+++ b/backend/test/v040_p4_coverage.test.ts
@@ -0,0 +1,75 @@
+/**
+ * v0.4.0 – Priorität 4: Datengrundlage je Wettbewerb; Champions League ohne Historie → INSUFFICIENT DATA.
+ * Provider-Antworten nach der offiziellen v4-Doku NACHGEBAUT; CSV synthetisch. Kein Live-Nachweis.
+ */
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import { buildApp } from '../src/app.js';
+import { testOddsApiConnection, UCL_SPORT_KEY } from '../src/engines/oddsApiStatus.js';
+import { competitionCoverage } from '../src/engines/coverage.js';
+import { importFootballDataCsv } from '../src/providers/footballDataCsv.js';
+import { memDb, testConfig } from './helpers.js';
+import { e0Csv, fakeFetcher, oddsEvent } from './fixtures/theOddsApiSamples.js';
+
+const H = 3_600_000, MIN = 60_000;
+const TEAMS = ['Arsenal', 'Chelsea', 'Everton', 'Fulham', 'Liverpool', 'Brentford', 'Burnley', 'Wolves'];
+
+async function scenario() {
+  const now = Date.now();
+  const epl = oddsEvent({ id: 'epl-1', sport: 'soccer_epl', title: 'EPL', home: 'Arsenal', away: 'Chelsea', kickoff: now + 20 * H, updatedAt: now - 2 * MIN });
+  const ucl = oddsEvent({ id: 'ucl-1', sport: UCL_SPORT_KEY, title: 'UEFA Champions League', home: 'Arsenal', away: 'Paris Saint Germain', kickoff: now + 22 * H, updatedAt: now - 2 * MIN });
+  const f = fakeFetcher((p) => {
+    if (p === '/v4/sports') return { body: [{ key: 'soccer_epl', active: true, has_outrights: false }, { key: UCL_SPORT_KEY, active: true, has_outrights: false }, { key: 'soccer_spain_la_liga', active: true, has_outrights: false }] };
+    if (p === '/v4/sports/soccer_epl/events') return { body: [epl].map(({ bookmakers, ...e }) => e) };
+    if (p === `/v4/sports/${UCL_SPORT_KEY}/events`) return { body: [ucl].map(({ bookmakers, ...e }) => e) };
+    if (p === '/v4/sports/soccer_epl/odds') return { body: [epl], headers: { 'x-requests-last': '2' } };
+    if (p === `/v4/sports/${UCL_SPORT_KEY}/odds`) return { body: [ucl], headers: { 'x-requests-last': '2' } };
+    if (p.endsWith('/events') || p.endsWith('/odds')) return { body: [] };
+    return null;
+  });
+  const cfg = testConfig({ DATA_MODE: 'live', THE_ODDS_API_KEY: 'test-key-NOT-REAL-p4', THE_ODDS_API_SPORT_KEYS: `soccer_epl,${UCL_SPORT_KEY},soccer_spain_la_liga` });
+  const app = buildApp(cfg, { db: memDb(), fetcher: f.fetcher, requireOddsConnectionTest: true });
+  importFootballDataCsv(app.db, e0Csv(TEAMS, 4, Date.UTC(2025, 0, 5)), 'E0.csv');
+  await testOddsApiConnection(app, { triggeredBy: 'test' });
+  const sum = await app.sync.run(new Date(now));
+  return { app, now, sum };
+}
+
+test('P4: Übersicht je Wettbewerb – EPL mit Historie berechenbar, Champions League INSUFFICIENT DATA mit Erklärung', async () => {
+  const { app, now } = await scenario();
+  const cov = competitionCoverage(app.db, app.cfg, new Date(now));
+  const epl = cov.competitions.find(c => c.sportKey === 'soccer_epl')!;
+  const ucl = cov.competitions.find(c => c.sportKey === UCL_SPORT_KEY)!;
+  const liga = cov.competitions.find(c => c.sportKey === 'soccer_spain_la_liga')!;
+  assert.ok(epl && ucl && liga, cov.competitions.map(c => c.name).join(', '));
+  assert.equal(epl.fixtures.available, true); assert.equal(epl.odds.available, true);
+  assert.equal(epl.history.available, true, `Historie ${epl.history.finishedMatches}`);
+  assert.equal(epl.models.computable, true);
+  assert.deepEqual(Object.values(epl.validation).map(v => v.status), ['UNVALIDATED', 'UNVALIDATED', 'UNVALIDATED']);
+  assert.ok(epl.explanation.some(e => /experimentell/.test(e)));
+  assert.equal(ucl.status, 'INSUFFICIENT DATA');
+  assert.equal(ucl.fixtures.available, true); assert.equal(ucl.odds.available, true, 'Quoten vorhanden – trotzdem keine Prognose');
+  assert.equal(ucl.history.finishedMatches, 0);
+  assert.equal(ucl.models.computable, false);
+  assert.ok(ucl.explanation.some(e => /keine geeignete Historie/.test(e) && /nicht ungeprüft übertragen/.test(e)), ucl.explanation.join(' | '));
+  assert.equal(liga.competitionId, null, 'konfigurierter Sport-Key ohne Spiele wird dennoch gelistet');
+  assert.equal(liga.status, 'INSUFFICIENT DATA');
+});
+
+test('P4: Champions League – keine Ersatzwahrscheinlichkeiten, keine Übertragung des EPL-Modells, keine Empfehlung', async () => {
+  const { app } = await scenario();
+  const ev = app.db.get<{ event_id: number }>("SELECT event_id FROM event_mappings WHERE provider = 'theoddsapi' AND provider_event_id = 'ucl-1'")!;
+  const pred = app.db.get<{ probs: string; data_quality: string }>('SELECT probs, data_quality FROM predictions WHERE event_id = ? ORDER BY id DESC LIMIT 1', ev.event_id)!;
+  assert.deepEqual(JSON.parse(pred.probs), {}, 'keine Wahrscheinlichkeiten');
+  const dq = JSON.parse(pred.data_quality);
+  assert.equal(dq.status, 'insufficient');
+  assert.ok(dq.issues.some((i: string) => /keine Historie für diesen Wettbewerb/.test(i)));
+  const sig = app.db.all<{ status: string; model_prob: number | null }>('SELECT status, model_prob FROM value_signals WHERE event_id = ? AND active = 1', ev.event_id);
+  assert.ok(sig.length && sig.every(s => ['INSUFFICIENT_DATA', 'MARKET_SUSPENDED'].includes(s.status) && s.model_prob == null), JSON.stringify(sig));
+  assert.ok(sig.some(s => s.status === 'INSUFFICIENT_DATA'));
+  assert.equal(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recommendations WHERE event_id = ? AND active = 1', ev.event_id)!.n, 0);
+  // Das EPL-Spiel desselben Teams hat dagegen eine Prognose aus der EPL-Historie
+  const eplEv = app.db.get<{ event_id: number }>("SELECT event_id FROM event_mappings WHERE provider = 'theoddsapi' AND provider_event_id = 'epl-1'")!;
+  const p2 = app.db.get<{ probs: string }>('SELECT probs FROM predictions WHERE event_id = ? ORDER BY id DESC LIMIT 1', eplEv.event_id)!;
+  assert.ok(JSON.parse(p2.probs)['1X2'], 'EPL-Prognose vorhanden');
+});
diff --git a/backend/test/v040_p5_ops.test.ts b/backend/test/v040_p5_ops.test.ts
new file mode 100644
index 0000000..3cce12d
--- /dev/null
+++ b/backend/test/v040_p5_ops.test.ts
@@ -0,0 +1,128 @@
+/**
+ * v0.4.0 – Priorität 5: Konfiguration, .env-Verhalten, KI-Analyst-Fallback, Migration 008.
+ * Der Analyst wird mit einem eingespielten Fetcher geprüft (kein Netzwerk, kein echter Schlüssel).
+ */
+import { test } from 'node:test';
+import assert from 'node:assert/strict';
+import fs from 'node:fs';
+import os from 'node:os';
+import path from 'node:path';
+import { ConfigError, loadConfig } from '../src/config.js';
+import { loadDotEnv } from '../src/env.js';
+import { EdgeAnalyst } from '../src/engines/analyst.js';
+import { Db, migrate } from '../src/db/db.js';
+import { ValueBettingEngine } from '../src/engines/value.js';
+import { PredictionEngine } from '../src/engines/prediction/index.js';
+import { ANCHOR, mockApp } from './helpers.js';
+
+test('P5: ungültiges DATA_MODE / STRATEGY wird nicht stillschweigend als Mock / BALANCED übernommen', () => {
+  assert.throws(() => loadConfig({ DATA_MODE: 'Live ' } as NodeJS.ProcessEnv), ConfigError);
+  assert.throws(() => loadConfig({ DATA_MODE: 'production' } as NodeJS.ProcessEnv), /DATA_MODE="production" ist ungültig/);
+  assert.throws(() => loadConfig({ STRATEGY: 'YOLO' } as NodeJS.ProcessEnv), ConfigError);
+  assert.equal(loadConfig({ DATA_MODE: 'live' } as NodeJS.ProcessEnv).dataMode, 'live');
+  assert.equal(loadConfig({} as NodeJS.ProcessEnv).dataMode, 'mock', 'nicht gesetzt → Mock (mit Hinweis in configIssues)');
+  assert.equal(loadConfig({ STRATEGY: 'conservative' } as NodeJS.ProcessEnv).analysis.strategy, 'CONSERVATIVE');
+  const c = loadConfig({} as NodeJS.ProcessEnv);
+  assert.equal(c.analysis.minEv, 0.05); assert.equal(c.analysis.strategy, 'BALANCED'); assert.equal(c.analysis.maxRecommendations, 5); assert.equal(c.timezone, 'America/Asuncion');
+});
+
+test('P5: .env – echte Umgebungsvariablen haben Vorrang, leere Platzhalter werden ignoriert, ENV_FILE=none lädt nichts', () => {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canchaia-env-'));
+  fs.writeFileSync(path.join(dir, '.env'), 'DATA_MODE=live\nTHE_ODDS_API_KEY=from-file-NOT-REAL\nADMIN_EMAIL=\n# Kommentar\nMIN_EV=0.07\n');
+  const env: NodeJS.ProcessEnv = { THE_ODDS_API_KEY: 'from-real-env-NOT-REAL' };
+  const r = loadDotEnv(env, dir);
+  assert.equal(r.file, path.join(dir, '.env'));
+  assert.equal(env.THE_ODDS_API_KEY, 'from-real-env-NOT-REAL', 'Secret aus der echten Umgebung wird nicht überschrieben');
+  assert.equal(env.DATA_MODE, 'live'); assert.equal(env.MIN_EV, '0.07');
+  assert.equal(env.ADMIN_EMAIL, undefined, 'leerer Platzhalter gilt nicht als gesetzt');
+  assert.equal(r.applied, 2); assert.equal(r.skippedExisting, 1);
+  assert.ok(!JSON.stringify(r).includes('NOT-REAL'), 'Ergebnis enthält keine Werte');
+  assert.equal(loadDotEnv({ ENV_FILE: 'none' }, dir).file, null);
+  assert.match(loadDotEnv({ ENV_FILE: 'fehlt.env' }, dir).error ?? '', /nicht gefunden/);
+});
+
+function fakeAnthropic(reply: (body: any) => { status: number; json: unknown }) {
+  const seen: { headers: Record<string, string>; body: any }[] = [];
+  const f = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
+    const body = JSON.parse(init.body); seen.push({ headers: init.headers, body });
+    const r = reply(body);
+    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json } as Response;
+  }) as unknown as typeof fetch;
+  return { f, seen };
+}
+
+test('P5: KI-Analyst – ohne Schlüssel klar gekennzeichneter lokaler Regelmodus', async () => {
+  const app = await mockApp();
+  const a = await new EdgeAnalyst(app.db, app.cfg).ask('top', 'es', [], ANCHOR);
+  assert.equal(a.mode, 'rules');
+  assert.match(a.fallbackReason ?? '', /kein KI-Schlüssel konfiguriert: lokaler Regelmodus/);
+});
+
+test('P5: KI-Analyst – Modell konfigurierbar, effort und Server-Fallback nur für unterstützte Modelle; Fehler/Ablehnung → gekennzeichneter Fallback', async () => {
+  const app = await mockApp({ ANTHROPIC_API_KEY: 'sk-test-NOT-REAL' });
+  assert.equal(app.cfg.anthropic.model, 'claude-sonnet-5-5');
+  const ok = fakeAnthropic(() => ({ status: 200, json: { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Respuesta' }] } }));
+  const r1 = await new EdgeAnalyst(app.db, app.cfg, ok.f).ask('hola', 'es', [], ANCHOR);
+  assert.equal(r1.mode, 'llm'); assert.equal(r1.answer, 'Respuesta'); assert.equal(r1.model, 'claude-sonnet-5-5');
+  assert.equal(ok.seen[0].body.model, 'claude-sonnet-5-5');
+  assert.deepEqual(ok.seen[0].body.output_config, { effort: 'low' });
+  assert.equal(ok.seen[0].body.fallbacks, 'default');
+  assert.equal(ok.seen[0].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
+  assert.ok(!JSON.stringify(ok.seen[0].body).includes('sk-test'), 'Schlüssel nur im Header');
+  // Anderes Modell per Konfiguration; ohne Server-Fallback-Unterstützung kein beta-Header
+  const app2 = await mockApp({ ANTHROPIC_API_KEY: 'sk-test-NOT-REAL', ANTHROPIC_MODEL: 'claude-haiku-5-5', ANTHROPIC_EFFORT: 'none' });
+  const ok2 = fakeAnthropic(() => ({ status: 200, json: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] } }));
+  await new EdgeAnalyst(app2.db, app2.cfg, ok2.f).ask('hola', 'es', [], ANCHOR);
+  assert.equal(ok2.seen[0].body.model, 'claude-haiku-5-5');
+  assert.equal(ok2.seen[0].body.fallbacks, undefined); assert.equal(ok2.seen[0].headers['anthropic-beta'], undefined); assert.equal(ok2.seen[0].body.output_config, undefined);
+  // Unbekanntes Modell (HTTP 404) → Regelmodus mit Grund
+  const nf = fakeAnthropic(() => ({ status: 404, json: { type: 'error' } }));
+  const r3 = await new EdgeAnalyst(app.db, app.cfg, nf.f).ask('top', 'es', [], ANCHOR);
+  assert.equal(r3.mode, 'rules'); assert.match(r3.fallbackReason ?? '', /HTTP 404/);
+  // Ablehnung und abgeschnittene Antwort werden nicht als Analyse ausgegeben
+  for (const stop of ['refusal', 'max_tokens']) {
+    const x = fakeAnthropic(() => ({ status: 200, json: { stop_reason: stop, content: [] } }));
+    const r = await new EdgeAnalyst(app.db, app.cfg, x.f).ask('top', 'es', [], ANCHOR);
+    assert.equal(r.mode, 'rules', stop); assert.match(r.fallbackReason ?? '', new RegExp(stop));
+  }
+});
+
+test('P5: Upgrade v0.3.4 → v0.4.0 (Migration 008) erhält Daten; alte Signale ohne Signatur werden genau einmal neu versioniert; Neustart idempotent', async () => {
+  const dir = path.resolve('src/db/migrations');
+  const app = await mockApp();
+  await app.sync.run(ANCHOR);
+  // Den Stand von v0.3.4 nachbilden: eine DB mit 001–007 und denselben Daten
+  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'canchaia-up-')), 'db.sqlite');
+  const old = new Db(file);
+  old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
+  for (const f of fs.readdirSync(dir).filter(f => f < '008').sort()) { old.exec(fs.readFileSync(path.join(dir, f), 'utf8')); old.run('INSERT INTO schema_migrations VALUES (?, ?)', f, 'x'); }
+  old.run("INSERT INTO competitions (id, name) VALUES (1, 'L')");
+  old.run("INSERT INTO teams (id, name, norm_name) VALUES (1, 'A', 'a'), (2, 'B', 'b')");
+  old.run("INSERT INTO events (id, competition_id, home_team_id, away_team_id, kickoff_utc, status) VALUES (1, 1, 1, 2, '2030-01-01T19:00:00Z', 'scheduled')");
+  old.run(`INSERT INTO predictions (id, event_id, model_version, created_at, probs, components, uncertainty, data_quality, inputs_hash) VALUES (1, 1, 'ensemble-1.0.0', '2026-10-01T00:00:00Z', '{}', '[]', '{}', '{"score":0,"status":"insufficient","issues":[]}', 'h')`);
+  old.run(`INSERT INTO value_signals (id, event_id, prediction_id, market_id, selection_id, status, reasons, active, created_at) VALUES (1, 1, 1, '1X2', 'HOME', 'VALUE', '[]', 1, '2026-10-01T00:00:00Z')`);
+  old.run("INSERT INTO model_versions (id, description, weights, validation_status) VALUES ('ensemble-1.1.0+bt7', 'alt', '{}', 'VALIDATED')");
+  old.close();
+  const db = new Db(file);
+  assert.deepEqual(migrate(db), ['008_v040_pilot_consistency.sql']);
+  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM value_signals')!.n, 1, 'Signal erhalten');
+  assert.equal(db.get<{ s: string | null }>('SELECT calc_signature AS s FROM value_signals WHERE id = 1')!.s, null);
+  assert.equal(db.get<{ v: string }>("SELECT validation_status AS v FROM model_versions WHERE id = 'ensemble-1.1.0+bt7'")!.v, 'VALIDATED', 'alte Modellversion unverändert');
+  assert.equal(new PredictionEngine(db).currentModelVersion(1).status, 'UNVALIDATED', 'alte globale Validierung gilt ohne Scope-Eintrag nicht mehr');
+  db.run("INSERT INTO model_scope_validations (model_version_id, competition_id, market_id, status, market_evidence, holdout_n, market_n, reasons, created_at) VALUES ('ensemble-1.1.0+bt7', 1, 'OU', 'UNVALIDATED', 'NOT_TESTABLE', 1, 0, '[]', 'x')");
+  assert.throws(() => db.run("UPDATE model_scope_validations SET status = 'VALIDATED'"), /unveraenderlich/, 'Scope-Validierungen sind unveränderlich');
+  assert.throws(() => db.run('DELETE FROM model_scope_validations'), /unveraenderlich/);
+  db.close();
+  // Neustart: erneutes Öffnen ändert nichts
+  const again = new Db(file);
+  assert.deepEqual(migrate(again), []);
+  again.close();
+  // Neue Signale nach dem Upgrade tragen eine Signatur und werden bei identischer Neuberechnung nicht dupliziert
+  const v = new ValueBettingEngine(app.db);
+  const ev = app.db.get<{ event_id: number }>('SELECT event_id FROM value_signals WHERE active = 1 LIMIT 1')!;
+  const pred = new PredictionEngine(app.db).predictEvent(ev.event_id, ANCHOR)!;
+  const s = { minEv: 0.05, strategy: 'BALANCED' as const, oddsMaxAgeMinutes: 90, preferredBookmakers: [], modelValidated: false, isMock: true };
+  app.db.run('UPDATE value_signals SET calc_signature = NULL WHERE event_id = ?', ev.event_id);   // Zustand direkt nach dem Upgrade
+  assert.ok(v.persist(v.evaluate(pred, s, ANCHOR), ANCHOR).length > 0, 'einmalige Neuversionierung');
+  assert.equal(v.persist(v.evaluate(pred, s, ANCHOR), ANCHOR).length, 0, 'danach stabil');
+});
diff --git a/frontend/index.html b/frontend/index.html
index c41e25d..60ca221 100644
--- a/frontend/index.html
+++ b/frontend/index.html
@@ -7,7 +7,7 @@
   <title>CanchaIA · Inteligencia Futbolística</title>
   <meta name="application-name" content="CanchaIA">
   <meta name="apple-mobile-web-app-title" content="CanchaIA">
-  <meta name="description" content="CanchaIA – Inteligencia Futbolística. Análisis estadístico de fútbol con datos verificados para Paraguay y ligas internacionales. No garantiza ganancias; la app nunca realiza apuestas.">
+  <meta name="description" content="CanchaIA – Inteligencia Futbolística. Análisis estadístico de fútbol con cuotas validadas y modelos transparentes para Paraguay y ligas internacionales. No garantiza ganancias; la app nunca realiza apuestas.">
   <meta property="og:site_name" content="CanchaIA">
   <meta property="og:title" content="CanchaIA · Inteligencia Futbolística">
   <meta property="og:locale" content="es_PY">
diff --git a/frontend/package.json b/frontend/package.json
index 5e3ddf1..11e0797 100644
--- a/frontend/package.json
+++ b/frontend/package.json
@@ -1,10 +1,11 @@
 {
   "name": "aposta-edge-ai-frontend",
-  "version": "0.3.4",
+  "version": "0.4.0",
   "private": true,
   "type": "module",
   "scripts": {
-    "build": "node build.mjs",
+    "typecheck": "tsc -p tsconfig.json",
+    "build": "tsc -p tsconfig.json && node build.mjs",
     "dev": "node build.mjs --watch"
   },
   "dependencies": {
@@ -12,6 +13,12 @@
     "react-dom": "^19.2.0"
   },
   "devDependencies": {
-    "esbuild": "^0.28.0"
+    "@types/react": "^19.3.0",
+    "@types/react-dom": "^19.3.0",
+    "esbuild": "^0.28.0",
+    "typescript": "~6.0.3"
+  },
+  "engines": {
+    "node": ">=22.13"
   }
 }
diff --git a/frontend/src/coverage.tsx b/frontend/src/coverage.tsx
new file mode 100644
index 0000000..a75888e
--- /dev/null
+++ b/frontend/src/coverage.tsx
@@ -0,0 +1,47 @@
+/**
+ * v0.4.0 – Admin-Karte „Datengrundlage je Wettbewerb“. Alle Werte aus GET /api/admin/coverage (Backend, DB).
+ * Nichts wird hier berechnet oder ergänzt. Wettbewerbe ohne geeignete Historie zeigen INSUFFICIENT DATA mit Erklärung.
+ */
+import React from 'react';
+import { localTime } from './api';
+import { useApp } from './components';
+import { useLoad } from './hooks';
+import { Card, ErrorBox, Loading, StatusBadge } from './ui';
+
+const L = {
+  es: { title: 'Base de datos por competición', sub: 'Calendario · cuotas · historial · equipos · modelos · validación por mercado', comp: 'Competición', fixtures: 'Calendario', odds: 'Cuotas', history: 'Historial', teams: 'Equipos', models: 'Modelos', validation: 'Validación', yes: 'sí', no: 'no', next: 'próximo', none: 'Sin competiciones con datos.' },
+  de: { title: 'Datengrundlage je Wettbewerb', sub: 'Spielplan · Quoten · Historie · Teams · Modelle · Validierung je Markt', comp: 'Wettbewerb', fixtures: 'Spielplan', odds: 'Quoten', history: 'Historie', teams: 'Teams', models: 'Modelle', validation: 'Validierung', yes: 'ja', no: 'nein', next: 'nächstes', none: 'Keine Wettbewerbe mit Daten.' },
+  en: { title: 'Data foundation per competition', sub: 'Fixtures · odds · history · teams · models · validation per market', comp: 'Competition', fixtures: 'Fixtures', odds: 'Odds', history: 'History', teams: 'Teams', models: 'Models', validation: 'Validation', yes: 'yes', no: 'no', next: 'next', none: 'No competitions with data.' },
+};
+
+export function CoveragePanel() {
+  const { lang, tz } = useApp();
+  const T = L[lang] ?? L.es;
+  const c = useLoad<any>('/api/admin/coverage');
+  if (c.err) return <Card title={T.title}><ErrorBox e={c.err} onRetry={c.reload} /></Card>;
+  if (!c.data) return <Card title={T.title}><Loading lines={4} /></Card>;
+  const yn = (b: boolean) => b ? T.yes : T.no;
+  return (
+    <Card id="coverage" title={T.title} sub={T.sub}>
+      {!c.data.competitions.length ? <p className="small t-2">{T.none}</p> : <div className="stack lg">
+        {c.data.competitions.map((x: any) => (
+          <div key={x.competitionId ?? x.sportKey} className="stack" style={{ gap: 6, borderTop: '1px solid var(--line, rgba(127,127,127,.2))', paddingTop: 8 }}>
+            <div className="row-flex between" style={{ flexWrap: 'wrap', gap: 6 }}>
+              <strong>{x.name}{x.isMock ? ' (MOCK)' : ''}</strong>
+              <StatusBadge s={x.status} />
+            </div>
+            <dl className="kv small">
+              <dt>{T.fixtures}</dt><dd>{yn(x.fixtures.available)} · {x.fixtures.upcoming}{x.fixtures.nextKickoff ? ` · ${T.next} ${localTime(x.fixtures.nextKickoff, tz, lang)}` : ''}</dd>
+              <dt>{T.odds}</dt><dd>{yn(x.odds.available)} · 1X2 {x.odds.byMarket['1X2']} · OU {x.odds.byMarket.OU} · BTTS {x.odds.byMarket.BTTS}</dd>
+              <dt>{T.history}</dt><dd>{yn(x.history.available)} · {x.history.finishedMatches} ({x.history.seasons}) {x.history.sources.join(', ')}</dd>
+              <dt>{T.teams}</dt><dd>{yn(x.teams.unique)}{x.teams.unlinked ? ` · unlinked ${x.teams.unlinked}` : ''}{x.teams.withoutHistory.length ? ` · ${x.teams.withoutHistory.length} ≠ hist.` : ''}</dd>
+              <dt>{T.models}</dt><dd>{yn(x.models.computable)} · {x.models.eventsComputable}/{x.models.eventsTotal}{x.models.reason ? ` · ${x.models.reason}` : ''}</dd>
+              <dt>{T.validation}</dt><dd className="row-flex" style={{ flexWrap: 'wrap', gap: 4 }}>{(['1X2', 'OU', 'BTTS'] as const).map(m => <StatusBadge key={m} s={x.validation[m].status} label={`${m}: ${x.validation[m].status}${x.validation[m].marketEvidence === 'BETTER' ? ' +' : ''}`} />)}</dd>
+            </dl>
+            {x.explanation.length ? <ul className="xs t-2" style={{ margin: 0, paddingLeft: 18 }}>{x.explanation.map((e: string) => <li key={e}>{e}</li>)}</ul> : null}
+          </div>))}
+        <p className="xs t-3">{c.data.notes.join(' ')}</p>
+      </div>}
+    </Card>
+  );
+}
diff --git a/frontend/src/i18n.ts b/frontend/src/i18n.ts
index 1275b09..3317987 100644
--- a/frontend/src/i18n.ts
+++ b/frontend/src/i18n.ts
@@ -17,7 +17,7 @@ const es = {
   dataQuality: 'Calidad de datos', lineups: 'Alineaciones', injuries: 'Lesiones', lambdas: 'Goles esperados (λ)', modelsUsed: 'Modelos usados', uncertainty: 'Incertidumbre (σ)',
   available: 'disponible', unavailable: 'no disponible', form: 'Forma (últimos 10)', last: 'Últimos partidos', h2h: 'Enfrentamientos directos', oddsHistory: 'Historial de cuotas',
   invalid: 'inválida', valid: 'válida', retrieved: 'consultada', overround: 'Margen',
-  askPlaceholder: 'Pregunta al Analista IA…', send: 'Enviar', thinking: 'Analizando…', modeLlm: 'modelo de lenguaje con datos guardados', modeRules: 'modo reglas (sin clave de IA)',
+  askPlaceholder: 'Pregunta al Analista IA…', send: 'Enviar', thinking: 'Analizando…', modeLlm: 'modelo de lenguaje con datos guardados', modeRules: 'MODO LOCAL de reglas (sin modelo de IA externo)',
   suggestions: ['¿Cuáles son las cinco mejores value bets?', 'Busca partidos con al menos +5 % EV', '¿Qué tan fiable es el modelo?', '¿Cómo ha rendido el modelo hasta ahora?'],
   real: 'Real', mock: 'Mock', predictions: 'Pronósticos', settled: 'Liquidados', winRate: 'Acierto', roi: 'ROI', yieldL: 'Yield', brier: 'Brier', logLoss: 'Log Loss',
   avgOdds: 'Cuota media', clv: 'CLV medio', clvPos: 'CLV positivo', drawdown: 'Drawdown máx.', calibration: 'Calibración', cumProfit: 'Beneficio acumulado (1u por pick)',
@@ -50,7 +50,7 @@ const de: Dict = {
   dataQuality: 'Datenqualität', lineups: 'Aufstellungen', injuries: 'Verletzungen', lambdas: 'Torerwartung (λ)', modelsUsed: 'Verwendete Modelle', uncertainty: 'Unsicherheit (σ)',
   available: 'verfügbar', unavailable: 'nicht verfügbar', form: 'Form (letzte 10)', last: 'Letzte Spiele', h2h: 'Direkte Duelle', oddsHistory: 'Quotenverlauf',
   invalid: 'ungültig', valid: 'gültig', retrieved: 'abgerufen', overround: 'Marge',
-  askPlaceholder: 'Frag den KI-Analysten …', send: 'Senden', thinking: 'Analysiere …', modeLlm: 'Sprachmodell mit gespeicherten Daten', modeRules: 'Regelmodus (kein KI-Schlüssel)',
+  askPlaceholder: 'Frag den KI-Analysten …', send: 'Senden', thinking: 'Analysiere …', modeLlm: 'Sprachmodell mit gespeicherten Daten', modeRules: 'LOKALER Regelmodus (kein externes KI-Modell)',
   suggestions: ['Welche fünf besten Value Bets gibt es aktuell?', 'Suche Spiele mit mindestens +5 % EV', 'Wie zuverlässig ist das Modell?', 'Wie hat das Modell bisher abgeschnitten?'],
   real: 'Echt', predictions: 'Prognosen', settled: 'Abgerechnet', winRate: 'Trefferquote', avgOdds: 'Ø Quote', clv: 'Ø CLV', clvPos: 'CLV positiv', drawdown: 'Max. Drawdown',
   calibration: 'Kalibrierung', cumProfit: 'Kumulierter Gewinn (1u je Tipp)', runBacktest: 'Backtest starten', validated: 'Validierung', noData: 'Noch keine Daten.', simulated: 'SIMULIERT',
@@ -81,7 +81,7 @@ const en: Dict = {
   dataQuality: 'Data quality', lineups: 'Lineups', injuries: 'Injuries', lambdas: 'Expected goals (λ)', modelsUsed: 'Models used', uncertainty: 'Uncertainty (σ)',
   available: 'available', unavailable: 'unavailable', form: 'Form (last 10)', last: 'Recent matches', h2h: 'Head to head', oddsHistory: 'Odds history',
   invalid: 'invalid', valid: 'valid', retrieved: 'retrieved', overround: 'Margin',
-  askPlaceholder: 'Ask the AI Analyst…', send: 'Send', thinking: 'Analysing…', modeLlm: 'language model on stored data', modeRules: 'rules mode (no AI key)',
+  askPlaceholder: 'Ask the AI Analyst…', send: 'Send', thinking: 'Analysing…', modeLlm: 'language model on stored data', modeRules: 'LOCAL rules mode (no external AI model)',
   suggestions: ['What are the five best value bets right now?', 'Find matches with at least +5 % EV', 'How reliable is the model?', 'How has the model performed so far?'],
   real: 'Real', predictions: 'Predictions', settled: 'Settled', winRate: 'Win rate', avgOdds: 'Avg odds', clv: 'Avg CLV', clvPos: 'CLV positive', drawdown: 'Max drawdown',
   calibration: 'Calibration', cumProfit: 'Cumulative profit (1u per pick)', runBacktest: 'Run backtest', validated: 'Validation', noData: 'No data yet.', simulated: 'SIMULATED',
diff --git a/frontend/src/oddsapi.tsx b/frontend/src/oddsapi.tsx
index 7093628..23c6a92 100644
--- a/frontend/src/oddsapi.tsx
+++ b/frontend/src/oddsapi.tsx
@@ -14,17 +14,20 @@ const L = {
     lastTest: 'Última prueba', lastFetch: 'Última consulta de cuotas OK', remaining: 'Créditos restantes (proveedor)', used: 'Usados (proveedor)', last: 'Costo última consulta',
     daily: 'Presupuesto diario interno', monthly: 'Presupuesto mensual interno', events: 'Partidos reales importados', upcoming: 'próximos', books: 'Casas disponibles', markets: 'Mercados disponibles',
     fresh: 'Actualidad de datos', ago: 'hace {m} min', errors: 'Errores de API', none: 'Ninguno', paid: 'Consultas de pago', allowed: 'permitidas', blocked: 'bloqueadas', estimate: 'Estimación próxima ejecución',
-    ucl: 'Champions League', keys: 'Sport keys', regions: 'Regiones', never: 'nunca', reasons: 'Motivos', noKey: 'La clave nunca se muestra aquí ni se envía al navegador.' },
+    ucl: 'Champions League', keys: 'Sport keys', regions: 'Regiones', never: 'nunca', reasons: 'Motivos', noKey: 'La clave nunca se muestra aquí ni se envía al navegador.',
+    evidence: 'Evidencia (qué está realmente comprobado)', conn: 'Conexión (gratis)', disc: 'Búsqueda de partidos (gratis)', odds: 'Cuotas (de pago)', preds: 'Pronósticos con cuotas reales', verified: 'VERIFICADO', notVerified: 'NO VERIFICADO', lastHttp: 'Última llamada real', next: 'Próxima ejecución', nextDisc: 'búsqueda', nextOdds: 'cuotas', off: 'planificador desactivado' },
   de: { title: 'The Odds API', sub: 'Echte Quoten · Status vom Server berechnet', test: 'Verbindung testen (kostenlos)', testing: 'Teste …', testHint: 'GET /v4/sports · 1 Versuch · 0 Credits',
     lastTest: 'Letzter Test', lastFetch: 'Letzter erfolgreicher Quotenabruf', remaining: 'Restcredits (Anbieter)', used: 'Verbraucht (Anbieter)', last: 'Kosten letzter Abruf',
     daily: 'Internes Tagesbudget', monthly: 'Internes Monatsbudget', events: 'Echte importierte Spiele', upcoming: 'anstehend', books: 'Verfügbare Buchmacher', markets: 'Verfügbare Märkte',
     fresh: 'Datenaktualität', ago: 'vor {m} min', errors: 'API-Fehler', none: 'Keine', paid: 'Kostenpflichtige Abrufe', allowed: 'freigegeben', blocked: 'gesperrt', estimate: 'Schätzung nächster Lauf',
-    ucl: 'Champions League', keys: 'Sport-Keys', regions: 'Regionen', never: 'nie', reasons: 'Gründe', noKey: 'Der Schlüssel wird hier nie angezeigt und nie an den Browser gesendet.' },
+    ucl: 'Champions League', keys: 'Sport-Keys', regions: 'Regionen', never: 'nie', reasons: 'Gründe', noKey: 'Der Schlüssel wird hier nie angezeigt und nie an den Browser gesendet.',
+    evidence: 'Nachweise (was tatsächlich belegt ist)', conn: 'Verbindung (kostenlos)', disc: 'Spielsuche (kostenlos)', odds: 'Quoten (kostenpflichtig)', preds: 'Prognosen mit echten Quoten', verified: 'VERIFIZIERT', notVerified: 'NICHT VERIFIZIERT', lastHttp: 'Letzter echter Abruf', next: 'Nächster Lauf', nextDisc: 'Spielsuche', nextOdds: 'Quoten', off: 'Scheduler aus' },
   en: { title: 'The Odds API', sub: 'Real odds · status computed on the server', test: 'Test connection (free)', testing: 'Testing…', testHint: 'GET /v4/sports · 1 attempt · 0 credits',
     lastTest: 'Last test', lastFetch: 'Last successful odds fetch', remaining: 'Remaining credits (provider)', used: 'Used (provider)', last: 'Cost of last request',
     daily: 'Internal daily budget', monthly: 'Internal monthly budget', events: 'Real imported matches', upcoming: 'upcoming', books: 'Bookmakers available', markets: 'Markets available',
     fresh: 'Data freshness', ago: '{m} min ago', errors: 'API errors', none: 'None', paid: 'Paid requests', allowed: 'allowed', blocked: 'blocked', estimate: 'Next run estimate',
-    ucl: 'Champions League', keys: 'Sport keys', regions: 'Regions', never: 'never', reasons: 'Reasons', noKey: 'The key is never shown here and never sent to the browser.' },
+    ucl: 'Champions League', keys: 'Sport keys', regions: 'Regions', never: 'never', reasons: 'Reasons', noKey: 'The key is never shown here and never sent to the browser.',
+    evidence: 'Evidence (what is actually proven)', conn: 'Connection (free)', disc: 'Fixture discovery (free)', odds: 'Odds (paid)', preds: 'Predictions with real odds', verified: 'VERIFIED', notVerified: 'NOT VERIFIED', lastHttp: 'Last real request', next: 'Next run', nextDisc: 'discovery', nextOdds: 'odds', off: 'scheduler off' },
 };
 
 const n = (v: number | null | undefined) => v == null ? '–' : new Intl.NumberFormat('es-PY').format(v);
@@ -59,7 +62,18 @@ export function OddsApiPanel() {
           <Kpi label={T.events} value={n(d.events)} hint={`${n(d.upcomingEvents)} ${T.upcoming}`} />
           <Kpi label={T.fresh} value={d.ageMinutes == null ? '–' : T.ago.replace('{m}', String(d.ageMinutes))} hint={d.newestRetrievedAt ? when(d.newestRetrievedAt) : undefined} />
         </div>
+        {x.verification ? <div className="stack" style={{ gap: 6 }}>
+          <div className="small t-2">{T.evidence}</div>
+          {([['conn', x.verification.connection], ['disc', x.verification.discovery], ['odds', x.verification.odds], ['preds', x.verification.predictions]] as [keyof typeof T, any][]).map(([k, v]) =>
+            <div key={k} className="row-flex between small" style={{ flexWrap: 'wrap', gap: 6 }}>
+              <span>{T[k]}</span>
+              <span className="row-flex"><Badge tone={v.verified ? 'value' : 'watch'} dot>{v.verified ? T.verified : T.notVerified}</Badge>{v.at ? <span className="t-3">{when(v.at)}</span> : null}</span>
+              <span className="xs t-3" style={{ flexBasis: '100%' }}>{v.note}</span>
+            </div>)}
+        </div> : null}
         <dl className="kv small">
+          <dt>{T.lastHttp}</dt><dd>{x.lastHttp ? `${when(x.lastHttp.at)} · HTTP ${x.lastHttp.status} · ${x.lastHttp.endpoint} · ${x.lastHttp.costCredits} credits` : T.never}</dd>
+          <dt>{T.next}</dt><dd>{x.schedule ? `${T.nextDisc}: ${x.schedule.discovery?.nextDue ? when(x.schedule.discovery.nextDue) : '–'} (${x.schedule.discovery?.intervalMin ?? '–'} min) · ${T.nextOdds}: ${x.schedule.odds?.nextDue ? when(x.schedule.odds.nextDue) : '–'} (${x.schedule.odds?.intervalMin ?? '–'} min)` : T.off}</dd>
           <dt>{T.lastTest}</dt><dd>{lt ? <span className="row-flex"><StatusBadge s={lt.ok ? 'OK' : 'FAILED'} /> {when(lt.testedAt)} · HTTP {lt.httpStatus ?? '–'} {lt.error ? <span className="t-2">· {lt.error}</span> : null}</span> : T.never}</dd>
           <dt>{T.lastFetch}</dt><dd>{when(x.lastSuccessfulFetchAt)}</dd>
           <dt>{T.ucl}</dt><dd>{lt ? <StatusBadge s={lt.targetSportStatus === 'ACTIVE' ? 'ACTIVE' : lt.targetSportStatus === 'NOT_CHECKED' ? null : 'DEGRADED'} label={`${lt.targetSportKey}: ${lt.targetSportStatus}`} /> : '–'}</dd>
diff --git a/frontend/src/pages/admin.tsx b/frontend/src/pages/admin.tsx
index 26201a9..4ed97e4 100644
--- a/frontend/src/pages/admin.tsx
+++ b/frontend/src/pages/admin.tsx
@@ -7,6 +7,7 @@ import { useLoad } from '../hooks';
 import { Banner, Button, Card, ErrorBox, Field, Loading, PageHeader, StatusBadge } from '../ui';
 import { ProviderStates, ControlledSync, ApiLog, Validation, PaymentsAdmin } from '../v030';
 import { OddsApiPanel } from '../oddsapi';
+import { CoveragePanel } from '../coverage';
 
 export function Admin() {
   const { t, lang, tz } = useApp();
@@ -22,6 +23,7 @@ export function Admin() {
       <PageHeader title="Admin" lead={`${x.dataMode.toUpperCase()} · ${x.providerStates?.map((p: any) => `${p.provider}: ${p.status}`).join(' · ') ?? ''}`} actions={<Button variant="secondary" size="sm" icon="refresh" onClick={d.reload}>{t.refresh}</Button>} />
       {x.configIssues.length ? <Banner tone="error" title="Config">{x.configIssues.map((i: string) => <div key={i}>{i}</div>)}</Banner> : null}
       <OddsApiPanel />
+      <CoveragePanel />
       {x.providerStates ? <ProviderStates states={x.providerStates} pilot={x.pilot} /> : null}
       <ControlledSync />
       {x.apiRequestLog ? <ApiLog rows={x.apiRequestLog} /> : null}
diff --git a/frontend/src/pages/edge.tsx b/frontend/src/pages/edge.tsx
index 8bf2967..8321974 100644
--- a/frontend/src/pages/edge.tsx
+++ b/frontend/src/pages/edge.tsx
@@ -11,7 +11,7 @@ import { ANALYST } from '../brand';
 import { useApp } from '../components';
 import { Badge, Button, EdgeMeter, MockChip, PageHeader, SignalBadge, Skeleton, StatusBadge } from '../ui';
 
-interface Turn { q: string; a?: { answer: string; mode: string; toolsUsed: string[]; data: unknown[] }; err?: string }
+interface Turn { q: string; a?: { answer: string; mode: string; toolsUsed: string[]; data: unknown[]; model?: string; fallbackReason?: string }; err?: string }
 
 const isEventAnalysis = (d: any) => d && typeof d === 'object' && d.event && 'signals' in d;
 const isSignalList = (d: any) => Array.isArray(d) && d.length > 0 && d.every((x: any) => x == null || (x && 'market' in x && 'selection' in x && 'match' in x));
@@ -84,7 +84,7 @@ function Answer({ a }: { a: NonNullable<Turn['a']> }) {
     {blocks.length ? <Block code={u.bRisks} className="risks">{uniq.length ? <ul className="reasons">{uniq.map(r => <li key={r}>{tr(r, lang)}</li>)}</ul> : <span className="t-2 small">{u.noRisks}</span>}</Block> : null}
     <Block code={u.bVerdict} className="verdict wide" title={verdictBadge}>
       <div className="text">{a.answer}</div>
-      <span className="meta">{a.mode === 'llm' ? t.modeLlm : t.modeRules}{a.toolsUsed?.length ? ` · ${u.toolsUsed}: ${a.toolsUsed.join(', ')}` : ''}{!blocks.length ? ` · ${u.noStructured}` : ''}</span>
+      <span className="meta">{a.mode === 'llm' ? `${t.modeLlm}${a.model ? ` (${a.model})` : ''}` : t.modeRules}{a.mode === 'rules' && a.fallbackReason ? ` · ${tr(a.fallbackReason, lang)}` : ''}{a.toolsUsed?.length ? ` · ${u.toolsUsed}: ${a.toolsUsed.join(', ')}` : ''}{!blocks.length ? ` · ${u.noStructured}` : ''}</span>
     </Block>
   </div>;
 }
diff --git a/frontend/src/pages/performance.tsx b/frontend/src/pages/performance.tsx
index ce7ec48..ff098da 100644
--- a/frontend/src/pages/performance.tsx
+++ b/frontend/src/pages/performance.tsx
@@ -55,7 +55,12 @@ export function Performance() {
         {btm ? <div className="grid two">
           <div className="stack">
             <div className="row-flex"><StatusBadge s={btm.validation.status} /><span className="t-3 small">Walk-forward {btm.matches.walkForward} · Holdout {btm.matches.holdout}</span></div>
-            <ul className="reasons">{btm.validation.reasons.map((r: string) => <li key={r}>{tr(r, lang)}</li>)}</ul>
+            {btm.scopes?.length ? <div className="tablewrap"><table><thead><tr><th>{lang === 'de' ? 'Bereich' : lang === 'en' ? 'Scope' : 'Ámbito'}</th><th>{t.status}</th><th>{lang === 'de' ? 'vs. Markt' : lang === 'en' ? 'vs market' : 'vs mercado'}</th><th className="n">n</th></tr></thead>
+              <tbody>{btm.scopes.map((x: any) => <tr key={`${x.competitionId}-${x.market}`}><td className="small">{x.competition} · {MKT[x.market] ?? x.market}</td><td><StatusBadge s={x.status} /></td>
+                <td className="small">{x.marketEvidence === 'BETTER' ? (lang === 'de' ? 'Mehrwert belegt' : lang === 'en' ? 'edge shown' : 'ventaja mostrada') : x.marketEvidence === 'NOT_WORSE' ? (lang === 'de' ? 'nicht schlechter – kein Mehrwert-Nachweis' : lang === 'en' ? 'not worse – no edge shown' : 'no peor – sin ventaja demostrada') : x.marketEvidence === 'WORSE' ? (lang === 'de' ? 'schlechter' : lang === 'en' ? 'worse' : 'peor') : (lang === 'de' ? 'nicht prüfbar' : lang === 'en' ? 'not testable' : 'no comprobable')}{x.oddsTimesEstimated ? ' · *' : ''}</td>
+                <td className="n">{x.n}</td></tr>)}</tbody></table>
+              <p className="t-3 xs" style={{ marginTop: 6 }}>{lang === 'de' ? 'Nur Bereiche mit VALIDATED gelten live als validiert. * Quotenzeitpunkte geschätzt.' : lang === 'en' ? 'Only VALIDATED scopes count as validated live. * Odds times estimated.' : 'Solo los ámbitos VALIDATED cuentan como validados. * Hora de cuotas estimada.'}</p></div> : null}
+            <ul className="reasons">{btm.validation.reasons.slice(0, 8).map((r: string) => <li key={r}>{tr(r, lang)}</li>)}{btm.validation.reasons.length > 8 ? <li className="t-3">… +{btm.validation.reasons.length - 8}</li> : null}</ul>
             <div className="tablewrap"><table><thead><tr><th>Holdout</th><th className="n">Log Loss</th><th className="n">Baseline</th><th className="n">Brier</th><th className="n">ECE</th></tr></thead>
               <tbody>{Object.entries(btm.holdoutEnsemble).map(([k, x]: any) => <tr key={k}><td>{MKT[k]}</td><td className={`n ${x.logLoss < btm.baseline[k]?.logLoss ? 'pos' : 'neg'}`}>{fx(x.logLoss, 4)}</td><td className="n">{fx(btm.baseline[k]?.logLoss, 4)}</td><td className="n">{fx(x.brier, 4)}</td><td className="n">{fx(x.ece, 3)}</td></tr>)}</tbody></table></div>
             {btm.betting ? <Banner tone="warn" title={t.simulated}>{btm.betting.bets} bets · ROI {signed(btm.betting.roi)} · Ø {fx(btm.betting.avgOdds)} · CLV {signed(btm.betting.avgClv, 2)} · DD {btm.betting.maxDrawdown}u. {btm.betting.note}</Banner>
diff --git a/frontend/src/reasons.ts b/frontend/src/reasons.ts
index 5dfbbef..0005c55 100644
--- a/frontend/src/reasons.ts
+++ b/frontend/src/reasons.ts
@@ -46,11 +46,17 @@ const R: [RegExp, string, string][] = [
   [/^Modell weicht (-?[\d.]+) Prozentpunkte vom fairen Marktpreis ab \((.*)\)\. .*$/, 'El modelo se aparta $1 puntos del precio justo del mercado ($2). Indica más bien información faltante o errores de datos que valor.', 'Model deviates $1 points from the fair market price ($2). This points to missing information or data errors rather than value.'],
   [/^EV (-?[\d.]+) %, auch an der Untergrenze positiv \((-?[\d.]+) %\)$/, 'EV $1 %, positivo también en el límite inferior ($2 %)', 'EV $1 %, positive even at the lower bound ($2 %)'],
   [/^Modell UNVALIDATED: STRONG_VALUE erst nach bestandenem Backtest$/, 'Modelo UNVALIDATED: STRONG_VALUE solo tras superar el backtest', 'Model UNVALIDATED: STRONG_VALUE only after a passed backtest'],
+  [/^Modell für diesen Markt\/Wettbewerb UNVALIDATED: .*$/, 'Modelo UNVALIDATED para este mercado/competición: señal experimental, sin ventaja demostrada', 'Model UNVALIDATED for this market/competition: experimental signal, no proven edge'],
+  [/^Modell validiert, aber kein statistisch nachgewiesener Mehrwert gegenüber dem Markt: .*$/, 'Modelo validado, pero sin ventaja estadísticamente demostrada frente al mercado: STRONG_VALUE bloqueado', 'Model validated, but no statistically proven edge over the market: STRONG_VALUE blocked'],
+  [/^kein fairer Marktpreis ohne den bewerteten Buchmacher verfügbar: .*$/, 'No hay precio justo de mercado sin la casa evaluada: decisión solo con el modelo y plena incertidumbre', 'No fair market price without the evaluated bookmaker: model-only decision with full uncertainty'],
   [/^EV (-?[\d.]+) %, aber an der Untergrenze (-?[\d.]+) %: .*$/, 'EV $1 %, pero en el límite inferior $2 %: la ventaja está dentro de la incertidumbre del modelo', 'EV $1 %, but $2 % at the lower bound: the edge lies within model uncertainty'],
   [/^Datenqualität (\d+) unter Mindestwert (\d+) \((\w+)\)$/, 'Calidad de datos $1 por debajo del mínimo $2 ($3)', 'Data quality $1 below minimum $2 ($3)'],
   [/^EV (-?[\d.]+) % unter Mindest-EV (\d+) %$/, 'EV $1 % por debajo del EV mínimo $2 %', 'EV $1 % below minimum EV $2 %'],
   [/^zu wenig Teamhistorie \(Heim (\d+), Gast (\d+) Spiele\)$/, 'Poco historial (local $1, visitante $2 partidos)', 'Too little team history (home $1, away $2 matches)'],
   [/^kleine Ligadatenbasis \((\d+) Spiele\)$/, 'Base de datos de liga pequeña ($1 partidos)', 'Small league data base ($1 matches)'],
+  [/^keine Historie für diesen Wettbewerb: .*$/, 'Sin historial para esta competición: sin probabilidades (no se transfieren modelos de otras competiciones)', 'No history for this competition: no probabilities (models from other competitions are not transferred)'],
+  [/^kein KI-Schlüssel konfiguriert: lokaler Regelmodus$/, 'Sin clave de IA configurada: modo local de reglas', 'No AI key configured: local rules mode'],
+  [/^Sprachmodell nicht verfügbar \((.*)\): lokaler Regelmodus$/, 'Modelo de lenguaje no disponible ($1): modo local de reglas', 'Language model unavailable ($1): local rules mode'],
   [/^keine Aufstellungen$/, 'Sin alineaciones', 'No lineups'],
   [/^keine xG-Daten$/, 'Sin datos xG', 'No xG data'],
   [/^Verletzungen\/Sperren: keine Datenquelle angebunden$/, 'Lesiones/sanciones: no hay fuente conectada', 'Injuries/suspensions: no data source connected'],
diff --git a/frontend/src/ui.tsx b/frontend/src/ui.tsx
index 72f5b16..efc9759 100644
--- a/frontend/src/ui.tsx
+++ b/frontend/src/ui.tsx
@@ -37,7 +37,7 @@ export function statusTone(s: string | null | undefined): Tone {
   const v = String(s ?? '').toUpperCase();
   if (['OK', 'DONE', 'READY', 'ACTIVE', 'CONNECTED', 'VERIFIED', 'VALIDATED', 'AVAILABLE', 'LIVE VERIFIED'].includes(v)) return 'value';
   if (['FAILED', 'DOWN', 'BLOCKED', 'ERROR', 'DISCONNECTED', 'REJECTED', 'EXPIRED', 'INTERRUPTED'].includes(v)) return 'avoid';
-  if (['PAUSED', 'PAUSED_QUOTA', 'DEGRADED', 'UNVALIDATED', 'PENDING', 'PROOF_SUBMITTED', 'AWAITING_PAYMENT', 'RUNNING', 'NOT VERIFIED', 'NOT CONNECTED', 'BUDGET'].includes(v)) return 'watch';
+  if (['PAUSED', 'PAUSED_QUOTA', 'DEGRADED', 'UNVALIDATED', 'PARTIAL', 'NO FIXTURES', 'INSUFFICIENT DATA', 'PENDING', 'PROOF_SUBMITTED', 'AWAITING_PAYMENT', 'RUNNING', 'NOT VERIFIED', 'NOT CONNECTED', 'BUDGET'].includes(v)) return 'watch';
   return 'outline';
 }
 export const StatusBadge = ({ s, label }: { s: string | null | undefined; label?: string }) => <Badge tone={statusTone(s)} dot>{label ?? s ?? '–'}</Badge>;
diff --git a/frontend/tsconfig.json b/frontend/tsconfig.json
new file mode 100644
index 0000000..34d0ee7
--- /dev/null
+++ b/frontend/tsconfig.json
@@ -0,0 +1,18 @@
+{
+  "compilerOptions": {
+    "target": "ES2020",
+    "lib": ["ES2022", "DOM", "DOM.Iterable"],
+    "module": "ESNext",
+    "moduleResolution": "Bundler",
+    "jsx": "react-jsx",
+    "strict": true,
+    "noEmit": true,
+    "skipLibCheck": true,
+    "isolatedModules": true,
+    "esModuleInterop": true,
+    "allowImportingTsExtensions": false,
+    "noFallthroughCasesInSwitch": true,
+    "types": []
+  },
+  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.d.ts"]
+}
diff --git a/package.json b/package.json
index e18eaa5..aa5894f 100644
--- a/package.json
+++ b/package.json
@@ -1,14 +1,19 @@
 {
   "name": "aposta-edge-ai",
-  "version": "0.3.4",
+  "version": "0.4.0",
   "private": true,
   "description": "CanchaIA – Inteligencia Futbolística: Fußball-Analyse (Discovery, Prognosemodelle, Value-Engine, Backtesting, KI-Analyst). Technischer Paketname unverändert.",
   "scripts": {
-    "install:all": "npm --prefix backend install && npm --prefix frontend install",
+    "install:all": "npm --prefix backend ci --no-audit --no-fund && npm --prefix frontend ci --no-audit --no-fund",
     "build": "npm --prefix frontend run build && npm --prefix backend run build",
+    "typecheck": "npm --prefix frontend run typecheck && npm --prefix backend run typecheck",
     "test": "npm --prefix backend test",
+    "check": "npm run typecheck && npm test",
     "start": "npm --prefix backend start",
-    "dev:mock": "DATA_MODE=mock ADMIN_TOKEN=dev-token-change-me npm --prefix backend start"
+    "dev:mock": "node scripts/start.mjs mock",
+    "start:live": "node scripts/start.mjs live"
   },
-  "engines": { "node": ">=22.13" }
+  "engines": {
+    "node": ">=22.13"
+  }
 }
diff --git a/scripts/e2e-viewports.mjs b/scripts/e2e-viewports.mjs
new file mode 100644
index 0000000..eff8710
--- /dev/null
+++ b/scripts/e2e-viewports.mjs
@@ -0,0 +1,43 @@
+// v0.4.0 – Layoutprüfung der echten React-App (Mock-Modus) bei 375, 390, 430 px und Desktop (1440 px).
+// Prüft je Seite: kein horizontales Scrollen, keine JS-Fehler, Marke sichtbar, Spanisch als Standard. Speichert Screenshots.
+// Voraussetzung: laufender Server (Mock) mit Admin-Konto. Zugangsdaten NUR über Umgebung: E2E_EMAIL, E2E_PASSWORD.
+// Aufruf: E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-viewports.mjs <pfad-zu-playwright> <ausgabeordner> [basis-url]
+import { createRequire } from 'node:module';
+import fs from 'node:fs';
+const require = createRequire(import.meta.url);
+const { chromium } = require(process.argv[2]);
+const OUT = process.argv[3];
+const BASE = process.argv[4] ?? 'http://localhost:8080';
+const CRED = [process.env.E2E_EMAIL, process.env.E2E_PASSWORD];
+if (!CRED[0] || !CRED[1]) { console.error('E2E_EMAIL und E2E_PASSWORD setzen.'); process.exit(2); }
+fs.mkdirSync(OUT, { recursive: true });
+const WIDTHS = [[375, 812, true], [390, 844, true], [430, 932, true], [1440, 900, false]];
+const ROUTES = [['home', '/'], ['matches', '/matches'], ['edge', '/edge'], ['performance', '/performance'], ['settings', '/settings'], ['admin', '/admin']];
+const results = []; let failed = 0;
+const check = (name, ok, info = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' – ' + info : ''}`); if (!ok) failed++; };
+const browser = await chromium.launch();
+for (const [w, h, mobile] of WIDTHS) {
+  const c = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, locale: 'es-PY', timezoneId: 'America/Asuncion' });
+  const p = await c.newPage(); const errors = [];
+  p.on('pageerror', e => errors.push(String(e)));
+  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
+  await p.goto(BASE + '/'); await p.waitForSelector('#email');
+  check(`[${w}] Login: Spanisch als Standard`, (await p.evaluate(() => document.body.innerText)).includes('Iniciar sesión'));
+  await p.fill('#email', CRED[0]); await p.fill('#password', CRED[1]);
+  await p.click('form button.btn.block'); await p.waitForSelector('main.main', { timeout: 15000 });
+  for (const [name, hash] of ROUTES) {
+    await p.goto(BASE + '/#' + hash); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(900);
+    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, t: document.body.innerText,
+      wide: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.tablewrap, pre, .code'); }).slice(0, 3).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`) }));
+    check(`[${w}] ${name}: kein horizontales Scrollen`, m.sw <= m.iw, `scrollWidth ${m.sw} / innerWidth ${m.iw}${m.wide.length ? ' · ' + m.wide.join(', ') : ''}`);
+    check(`[${w}] ${name}: Marke CanchaIA sichtbar`, m.t.includes('CanchaIA') || (await p.locator('.brand').count()) > 0);
+    check(`[${w}] ${name}: keine Behauptung „verifiziert/nachgewiesen“ für experimentelle Signale`, !/ventaja (verificada|demostrada)(?! frente)|verified edge|proven edge(?! over)|nachgewiesener Vorteil/i.test(m.t.replace(/sin ventaja demostrada|no proven edge|kein nachgewiesener Vorteil/gi, '')));
+    await p.screenshot({ path: `${OUT}/${w}-${name}.png`, fullPage: false });
+  }
+  check(`[${w}] keine JS-Fehler`, errors.length === 0, errors.slice(0, 3).join(' | '));
+  await c.close();
+}
+await browser.close();
+fs.writeFileSync(`${OUT}/RESULTS.txt`, results.join('\n') + `\n\n${results.length - failed} PASS, ${failed} FAIL\n`);
+console.log(results.join('\n')); console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
+process.exit(failed ? 1 : 0);
diff --git a/scripts/start.mjs b/scripts/start.mjs
new file mode 100644
index 0000000..3a6c83f
--- /dev/null
+++ b/scripts/start.mjs
@@ -0,0 +1,46 @@
+// CanchaIA – plattformunabhängiger Start (Windows/PowerShell, Linux, macOS). v0.4.0
+// Aufruf:  node scripts/start.mjs [mock|live] [--no-install] [--no-build]
+//   mock  = fiktive Daten (Standard, wenn DATA_MODE nirgends gesetzt ist)
+//   live  = echte Provider gemäß .env / Umgebungsvariablen
+// Ablauf: Node-Version prüfen → .env anlegen (falls fehlt, aus .env.example) → Abhängigkeiten aus Lockfiles (npm ci)
+//         → Build inkl. Typprüfung → Backend starten. Es werden nie Werte von Secrets ausgegeben.
+import { spawn, spawnSync } from 'node:child_process';
+import fs from 'node:fs';
+import path from 'node:path';
+import { fileURLToPath } from 'node:url';
+
+const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
+const args = process.argv.slice(2);
+const mode = args.find(a => a === 'mock' || a === 'live');
+const bad = args.filter(a => !['mock', 'live', '--no-install', '--no-build'].includes(a));
+if (bad.length) { console.error(`Unbekannte Option(en): ${bad.join(' ')}\nAufruf: node scripts/start.mjs [mock|live] [--no-install] [--no-build]`); process.exit(2); }
+
+const [maj, min] = process.versions.node.split('.').map(Number);
+if (maj < 22 || (maj === 22 && min < 13)) { console.error(`Node.js >= 22.13 erforderlich (gefunden ${process.versions.node}). Node 22 LTS installieren: https://nodejs.org`); process.exit(3); }
+
+const npm = (cwd, ...a) => {
+  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', a, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
+  if (r.status !== 0) { console.error(`Fehlgeschlagen: npm ${a.join(' ')} (${path.relative(root, cwd) || '.'})`); process.exit(r.status ?? 1); }
+};
+
+// .env: nur anlegen, nie überschreiben. Echte Umgebungsvariablen haben im Backend immer Vorrang.
+const envFile = path.join(root, '.env');
+if (!fs.existsSync(envFile) && !process.env.ENV_FILE) {
+  fs.copyFileSync(path.join(root, '.env.example'), envFile);
+  try { fs.chmodSync(envFile, 0o600); } catch { /* Windows */ }
+  console.log(`.env aus .env.example angelegt: ${envFile}\n  → ADMIN_EMAIL und ADMIN_PASSWORD (≥ 12 Zeichen, Buchstaben + Ziffern) eintragen, sonst ist keine Anmeldung möglich.`);
+}
+
+if (!args.includes('--no-install')) for (const dir of ['backend', 'frontend']) {
+  const cwd = path.join(root, dir);
+  if (!fs.existsSync(path.join(cwd, 'node_modules'))) { console.log(`[install] ${dir}: npm ci (aus package-lock.json)`); npm(cwd, 'ci', '--no-audit', '--no-fund'); }
+}
+if (!args.includes('--no-build')) { console.log('[build] Frontend (mit Typprüfung) und Backend'); npm(root, 'run', 'build'); }
+
+const env = { ...process.env };
+if (mode) env.DATA_MODE = mode;
+console.log(`[start] CanchaIA · Modus: ${env.DATA_MODE ?? 'aus .env (Standard mock)'} · Zeitzone America/Asuncion · http://localhost:${env.PORT ?? 8080}`);
+if (mode === 'live') console.log('[start] LIVE: kostenpflichtige Quotenabrufe erst nach bestandenem kostenlosen Verbindungstest (Admin → The Odds API) und nur innerhalb der Budgets. SCHEDULER_ENABLED=false verhindert automatische Abrufe.');
+const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/src/main.js'], { cwd: path.join(root, 'backend'), env, stdio: 'inherit' });
+for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
+child.on('exit', code => process.exit(code ?? 0));
diff --git a/start-codespaces.sh b/start-codespaces.sh
index 669623b..f818d79 100644
--- a/start-codespaces.sh
+++ b/start-codespaces.sh
@@ -1,5 +1,5 @@
 #!/usr/bin/env bash
-# CanchaIA v0.3.4 - iPhone Codespaces launch helper.
+# CanchaIA v0.4.0 - iPhone Codespaces launch helper.
 # No external sports data calls except ONE free GET /v4/sports, and NO paid calls.
 set -Eeuo pipefail
 
@@ -7,7 +7,7 @@ cd "$(dirname "${BASH_SOURCE[0]}")"
 PROJECT_ROOT="$PWD"
 umask 077
 
-printf '\n=== CanchaIA v0.3.4 | GitHub Codespaces ===\n'
+printf '\n=== CanchaIA v0.4.0 | GitHub Codespaces ===\n'
 printf 'Modus: LIVE | Scheduler: AUS | Quotenabrufe: KEINE\n'
 
 # GitHub Codespaces injects secrets as environment variables. Never print their values.
diff --git a/start.ps1 b/start.ps1
new file mode 100644
index 0000000..b1caeda
--- /dev/null
+++ b/start.ps1
@@ -0,0 +1,7 @@
+# CanchaIA – Start unter Windows (PowerShell). Aufruf: .\start.ps1 [mock|live] [--no-install] [--no-build]
+# Falls die Ausführung von Skripten gesperrt ist: powershell -ExecutionPolicy Bypass -File .\start.ps1 mock
+$ErrorActionPreference = "Stop"
+Set-Location -Path $PSScriptRoot
+if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "Node.js >= 22.13 nicht gefunden (https://nodejs.org)."; exit 3 }
+& node scripts/start.mjs @args
+exit $LASTEXITCODE
diff --git a/start.sh b/start.sh
new file mode 100755
index 0000000..35de7dd
--- /dev/null
+++ b/start.sh
@@ -0,0 +1,6 @@
+#!/usr/bin/env bash
+# CanchaIA – Start unter Linux/macOS. Aufruf: ./start.sh [mock|live] [--no-install] [--no-build]
+set -Eeuo pipefail
+cd "$(dirname "${BASH_SOURCE[0]}")"
+command -v node >/dev/null 2>&1 || { echo "Node.js >= 22.13 nicht gefunden (https://nodejs.org)."; exit 3; }
+exec node scripts/start.mjs "$@"
```
