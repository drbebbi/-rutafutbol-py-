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
