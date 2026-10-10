# Aposta Edge AI – Technisches Audit und P0-Korrekturen

Stand: 10.10.2026 · Branch `claude/aposta-edge-audit` · Basis: Base44-Export (ZIP), unverändert in Commit `1229281` importiert.

Methode: vollständige Lektüre des Codes (Pipeline, Provider, Mathematik, Server-Funktionen, Routen, Entitäten, Agent),
Ausführen der Tests, numerische Nachprüfung der Modellausgaben, Korrektur der P0-Befunde mit Regressionstests.
Es gab **keinen Zugang** zu Aposta.la, API-Football, der Base44-Produktionsumgebung oder deren Daten.
Alles, was davon abhängt, ist unten als „ohne Live-Zugang nicht überprüfbar“ markiert.

---

## A. Produktionsreife (begründete Schätzung)

| Bereich | Vorher | Nachher | Begründung |
|---|---|---|---|
| Frontend | 50 % | 55 % | Seiten vorhanden und funktional; kein Mobile-/Design-Feinschliff, kein Ligafilter, Englisch statt Spanisch. |
| Backend / Pipeline-Logik | 25 % | 60 % | Kernlogik jetzt fail-closed, idempotent und getestet; Plattform-Laufzeit (Worker-Limits, SDK-Paginierung) unverifiziert. |
| Datenversorgung | 5 % | 10 % | Kein nachgewiesener rechtmäßiger Aposta-Livezugang. API-Football-Adapter vorhanden, aber nie gegen echte Antworten getestet. |
| Prognosemodell | 10 % | 25 % | Vorher für jedes Spiel identische Prognose. Jetzt eine nachvollziehbare Baseline (Form-Poisson) – aber unkalibriert und nicht validiert. |
| Tests | 30 % | 50 % | 152 Unit-/Integrationstests gegen eine Mock-DB. Keine E2E-Tests, keine Tests gegen echte Provider-Antworten oder die echte Base44-DB. |
| Deployment / Betrieb | 10 % | 20 % | Saubere Installation repariert, Lockfile, Lint, Scheduler-Endpunkt. SSR-Build lokal nicht reproduzierbar, kein CI, kein Rollback-Prozess, kein Scheduler konfiguriert. |
| **Gesamt** | **≈ 15 %** | **≈ 30 %** | Die App ist **nicht** veröffentlichungsreif. Der wichtigste Blocker ist die fehlende Datenquelle, nicht Code. |

„Vorher“ ist hoch angesetzt: In der Ausgangsversion hätte die App bei jeder gemappten Begegnung mit frischen Quoten „strong value“ auf Under 2,5 und BTTS-Nein angezeigt (siehe F01).

---

## B. Architektur und Datenfluss (Ist-Zustand nach den Korrekturen)

```
Aposta JSON-Endpunkt (APOSTA_EVENTS/ODDS_ENDPOINT)   Admin: manueller JSON-Import
            │ provenance=aposta_api                       │ provenance=manual_import (unverifiziert)
            ▼                                             ▼
   upsertApostaEvent ── Team/Competition (exakt oder Alias) ── Event (kickoff_history)
            │
            ├─ ensureMarket ─ recordOddsSnapshot ──► OddsSnapshot (append-only, snapshot_key)
            │                         └──────────► Selection.current_snapshot_id + odds_observed_at
            ▼
   matchExternalFixtures (API-Football, Datum-Cache) ─► EventMapping + Team.external_ids (Konfliktprüfung)
            ▼
   syncFootballData ─► TeamMatchStat (stat_key, verified, known_at)
            ▼
   runPredictionModels ─► Prediction vN (computation_status, market_probabilities, ±1 SE-Band, input_key)
            ▼
   calculateValueSignals (pure buildValueSignals) ─► ValueSignal (suppression_reasons, odds_snapshot_id)
            │                                         └► Recommendation-Ledger (published / shadow)
            ▼
   lockPastEvents (Closing Line, CLV) ─► syncResults (API-Football) ─► settleFinishedMatches (idempotent)
            ▼
   computePerformance / calculateModelMetrics  ──►  Performance-Seite, Edge-Analyst
Lesepfad: listRecommendations / Edge-Analyst ─► filterEligibleSignals ─► signalEligibility (zur Lesezeit neu berechnet)
Orchestrierung: runScheduledCycle (Lease) ◄─ Admin „Run Full Cycle“ oder POST /api/cron/cycle (CRON_SECRET)
```

Veröffentlicht („published“) wird ein Signal nur, wenn **alle** Bedingungen zur Lesezeit erfüllt sind:
verifizierte Herkunft · Spiel geplant, nicht gesperrt, Anstoß in der Zukunft · Markt **und** Selektion „open“ ·
alle Marktseiten vorhanden · Quote an Snapshot gebunden und seitdem unverändert · Quellbeobachtung < 30 min alt ·
Fixture-Mapping mit externer ID ≥ 0,85 · Prognose berechnet, vor Anstoß erstellt, nicht ersetzt ·
Modellversion `validation_status = validated` · EV ≥ Nutzer-Schwelle. Jeder nicht erfüllte Punkt erscheint als Grund.

---

## C. Testnachweis

| Prüfung | Ergebnis |
|---|---|
| `npm install` (wie Base44 `installCommand`) – Original | **schlägt fehl** (ERESOLVE: `@tanstack/ai-openai@0.22.8` verlangt `@tanstack/ai@^0.55`) |
| `npm install` – nach Pins + Override | erfolgreich, 0 ungültige Peers, `package-lock.json` erzeugt |
| `npx vitest run` – Original | 93/93 grün (die Tests deckten die unten genannten Fehler nicht ab) |
| `npx vitest run` – nach Korrekturen | **152/152 grün** (8 Dateien) |
| `npm run lint` – Original | schlägt fehl (keine ESLint-Konfiguration) |
| `npm run lint` – nachher | sauber |
| `vite build` | Client-Build erfolgreich; SSR-Build scheitert lokal an `cloudflare:workers` aus `base44:runtime` – erwartet die Nitro/workerd-Toolchain der Base44-Plattform. **Ohne Base44-Build nicht überprüfbar.** |

Die Tests verwenden eine In-Memory-Nachbildung der Base44-Entitäten (`src/lib/__tests__/helpers/mockDb.js`).
Ob die echte Base44-SDK-Abfragesprache sich identisch verhält (z. B. `id: {$in}`, gepunktete Pfade, `skip`), ist **nicht verifiziert**.

---

## D. Funktions-Statusmatrix

| Funktion | Status |
|---|---|
| Quotenmathematik (implizit, Marge, No-Vig, Fair Odds, EV) | Implementiert und getestet |
| Poisson-Matrix, 1X2 / O/U 2,5 / BTTS | Implementiert und getestet |
| Dixon-Coles | Formel implementiert und korrekt, **aber rho nie geschätzt** (rho = 0) → effektiv nicht genutzt |
| Elo | Formeln vorhanden; **kein Job aktualisiert Ratings** → nur verwendet, wenn gefittet (derzeit nie) |
| Platt-Kalibrierung | Funktion vorhanden, nie gefittet/verwendet |
| Value-Signale mit Gates und Gründen | Implementiert und getestet (neu) |
| Odds-Snapshots, Opening/High/Low, Snapshot-Verknüpfung | Implementiert und getestet |
| Closing Odds / CLV | Implementiert und getestet (neu); hängt von Quoten-Snapshots vor Anstoß ab |
| Event-Matching (API-Football) | Implementiert und getestet gegen synthetische Fixtures; **ohne Live-Zugang nicht überprüfbar** |
| Team-Statistiken, Aufstellungen, Verletzungen | Implementiert; Verletzungen fließen **nicht** ins Modell ein; ohne Live-Zugang nicht überprüfbar |
| Ergebnisse, Abrechnung, Recommendation-Ledger | Implementiert und getestet (neu) |
| Performance-Kennzahlen | Implementiert und getestet (neu, einheitliche Definition) |
| Walk-Forward-Backtest (STRICT_OBSERVED, T−24h, fixer Holdout, Baselines, Kalibrierung) | Implementiert und mit synthetischen Daten mechanisch getestet; **keine echten historischen Daten vorhanden → keine Ergebnisse** |
| Aposta-Livequelle | Nur generischer JSON-Adapter; **keine nachgewiesene offizielle Anbindung** |
| Scheduler | Endpunkt + Orchestrierung implementiert; **nicht konfiguriert, nicht auf der Plattform getestet** |
| KI-Analyst | Implementiert; liefert nur gegatete Daten; Antwortqualität nicht getestet |
| Spieltag-/Ligafilter, Prognose des Tages, Spanisch-Lokalisierung, Kalibrierungsdiagramm-UI | Nicht implementiert |
| Weitere Märkte (Double Chance, AH, Team Goals, Correct Score) | Bewusst nicht freigegeben (nur Mathe-Helfer vorhanden) |

---

## E. Befunde

Legende Status: ✅ behoben + Test · 🟡 teilweise · ⛔ offen

### P0 – kritisch

| ID | Datei / Funktion | Befund | Auswirkung | Korrektur | Status / Nachweis |
|---|---|---|---|---|---|
| F01 | `syncPipeline.runPredictionModels`, `predictionEngine.eloToLambda` | „Goal model“ war eine Kopie der Elo-Lambdas; Elo-Ratings werden nie aktualisiert (alle 1500); `eloToLambda` nutzte 1,35 als *Gesamt*tore. Ohne Statistik (Standardfall, siehe F02) erhielt **jedes Spiel** H 42,6 % / X 36,8 % / A 20,6 %, Under 2,5 = 82,7 %, BTTS-Nein = 75,7 %. | Bei Quote 1,90 auf Under: EV +57 % → „strong value“ auf praktisch jedem Spiel. | Neues `modelInputs.buildModelLambdas`: ohne ≥ 6 verifizierte Spiele pro Team keine Prognose (`insufficient_data` + Gründe). Elo nur, wenn mit ≥ 10 Ergebnissen gefittet. Realistische Elo-Torskala (2,6). | ✅ `modelAndValue.test.js` „regression: unfitted defaults…“ |
| F02 | `matchExternalFixtures`, `syncFootballData` | `Team.external_ids.football_data_id` wurde nirgends gesetzt; `syncFootballData` überspringt Teams ohne diese ID. | Es wurden **nie** Statistiken geladen; Aufstellungs-/Verletzungs-Zuordnung kaputt. | `applyFixtureMapping` + `linkTeamExternalId` (mit Konfliktprüfung; Konflikt → „ambiguous“). Manuelles Mapping lädt das Fixture ebenfalls beim Provider. | ✅ `pipelineIntegrity.test.js` „fixture mapping links provider team ids“ |
| F03 | `provenance.predictionIsComputed` | Prüfte nur, ob `feature_snapshot` ein Objekt ist – das ist immer der Fall. | Gate „Prognose berechnet“ wirkungslos. | `computation_status === "computed"` erforderlich. | ✅ `provenance.test.js` |
| F04 | `calculateValueSignals` | `marketOpen: true` fest codiert; `sampleMet: true` für O/U und BTTS; Frische aus dem Prognosezeitpunkt; fehlende Marktseite → TypeError; kein Anstoß-Check. | Signale auf gesperrten Märkten, mit veralteten Quoten oder nach Anstoß. | Reiner `valueSignals.buildValueSignals` mit allen Gates und `suppression_reasons`. | ✅ `modelAndValue.test.js` „buildValueSignals“ |
| F05 | `recordOddsSnapshot`, `signalEligibility` | `Selection.current_snapshot_id` immer `null`; Signal nicht an die Quote gebunden, aus der es berechnet wurde. | Nach Quotenbewegung zeigte die App EV einer alten Quote. | Snapshot-ID wird verknüpft; Signal speichert `odds_snapshot_id`; Lesegate verlangt Übereinstimmung mit der aktuellen Selection. | ✅ beide Testdateien |
| F06 | `provenance.hasVerifiableProvenance` | „Verifiziert“ = nicht-leere ID + *beliebige* URL. Manuelle Importe galten als verifiziert. | Jede eingetippte Quote konnte als echte Aposta-Empfehlung erscheinen. | Nur `aposta_api` oder manuell **mit Admin-Bestätigung** (`source_verified_at/by`), jeweils mit `https://aposta.la`-URL; Re-Import löscht die Bestätigung. | ✅ `provenance.test.js` |
| F07 | `importApostaEventManual` | Setzte `last_odds_sync_at = jetzt`. | Beliebig alte, manuell kopierte Quoten galten 30 min als „frisch“. | Alter = Beobachtungszeit an der Quelle (`odds_observed_at`); ohne `source_timestamp` unbekannt = nie frisch. | ✅ `pipelineIntegrity.test.js` |
| F08 | `settleFinishedMatches` | Nichts setzte Status „finished“ oder Ergebnisse; fehlender Score ergab „away“; jeder Lauf erzeugte Duplikate; verwendete die neueste (evtl. nach Anstoß erstellte) Prognose. | Keine oder falsche Abrechnung, verzerrte Kennzahlen. | `syncResults` (nur bestätigtes FT; PST/CANC → Status; AET/PEN → Review); idempotente Abrechnung (`outcome_key`) mit der letzten Prognose **vor** Anstoß. | ✅ `pipelineIntegrity.test.js` „results and settlement“, `metricsBacktest.test.js` |
| F09 | `getPerformanceMetrics`, `edgeAiChat` | `Recommendation` wurde nirgends erzeugt → ROI immer 0; „Yield“ war der Gewinn in Einheiten; Log-Loss je Selektion binär statt je Spiel. | Performance-Seite ohne Aussagekraft bzw. falsch. | Recommendation-Ledger (published/shadow, idempotent); `metrics.js` als einzige Definition (Yield = ROI bei Flat-Stake, Drawdown, CLV, multiklassiger Log-Loss/Brier). | ✅ `metricsBacktest.test.js` |
| F10 | `package.json` | Kein Lockfile; frisches `npm install` scheitert an Peer-Konflikt. | Neues Deployment auf Base44 würde bereits bei der Installation scheitern (für die Plattform nicht verifiziert). | `@tanstack/ai-openai` exakt 0.22.6, Override `@tanstack/openai-base` 0.10.11, Lockfile. | ✅ saubere Installation nachgewiesen |
| F11 | `syncNow` | „Full Sync“ rief per-Event-Jobs mit `eventId = undefined` auf → Stats/Prognosen/Signale liefen ins Leere. Kein Scheduler. | Kein automatischer Betrieb möglich. | `runScheduledCycle` (geordnet, je Schritt isoliert, mit Lease), Admin-Button, `POST /api/cron/cycle` (Bearer `CRON_SECRET`). | 🟡 Code + Lease-Test; **Scheduler muss auf der Plattform eingerichtet werden** |

### P1 – hoch

| ID | Datei / Funktion | Befund | Korrektur | Status |
|---|---|---|---|---|
| F12 | `syncFootballData` | Jeder Lauf legte die letzten 10 Spiele erneut an; Abfrage-Limit 20 füllte sich mit Duplikaten. | Dedupe über `stat_key`. | ✅ |
| F13 | `eventMatcher.resolveTeam` | Teilstring-Treffer = 0,9 ≥ Schwelle → „Guaraní“ wurde mit „Guaraní de Trinidad“ zusammengelegt (reales PY-Beispiel). | Automatische Auflösung nur exakt oder per eindeutigem Alias; Teilstring max. 0,75. | ✅ |
| F14 | Metriken | Abfragen auf 500/1000 Datensätze begrenzt; „Accuracy“ = p ≥ 0,5 je Selektion. | `fetchAll` mit Paginierung, Top-Pick-Accuracy je Spiel. | 🟡 `skip`-Unterstützung des SDK unverifiziert |
| F15 | `confidenceScore` in der Pipeline | Aus fest codierten Konstanten (0,7 / 0,6 / 0,6) zusammengesetzt – statistisch unbegründet. | Ersetzt durch ±1-SE-Band der Eingangsdaten; Label nur aus gemessenen Größen; Datenqualität separat je Dimension. | ✅ |
| F16 | `ensureProductionModel` | Version als „poisson_dixon_coles“ mit „sigmoid“-Kalibrierung deklariert, obwohl rho = 0 und keine Kalibrierung. | Ehrliche Labels, `validation_status`, Admin-Funktion `setModelValidation` mit Backtest-Referenz. | ✅ |
| F17 | `upsertApostaEvent` | Verschobene Spiele wurden still überschrieben; Provider-Update konnte beendete Spiele wieder öffnen. | `kickoff_history`, Prognose ersetzt, Signale deaktiviert; Endstatus bleibt. | ✅ |
| F18 | `server-fns` Einstellungen/Watchlist | `UserSettings.filter({})` – Admins erhielten fremde Einstellungen; Update per beliebiger ID. | Filter auf `created_by_id`, Update nur eigener Datensatz. | ✅ |
| F19 | `base44/agents/edge-analyst.jsonc` | Plattform-Agent las `ValueSignal`/`Recommendation` direkt → umging alle Gates. | Lesezugriffe entfernt, Anweisung ergänzt. | ✅ |
| F20 | Nebenläufigkeit | `PipelineLease` existierte, wurde nie benutzt. | Best-Effort-Lease mit Übernahme veralteter Leases; alle Schreibpfade idempotent. Base44 bietet kein Compare-and-Set → kein harter Ausschluss. | 🟡 |
| F21 | `updateInjuriesAndLineups` | Fallback verglich externe mit interner Team-ID → Aufstellung landete beim falschen Team. | Zuordnung nur über verknüpfte Team-IDs, sonst überspringen. | ✅ |
| F22 | `scoreMatrix` | Bei λ ≳ 3,4 Restmasse > 1e-4 → Exception, Prognose-Job bricht ab. | Raster 0–15 Tore. | ✅ |
| F23 | Zeitstempel | 24 h Zukunftstoleranz; Zukunftsstempel galten als frisch. | 5 min Toleranz; Zukunft ≠ frisch. | ✅ |
| F24 | `lockPastEvents` | Filter `is_locked: false` verfehlt Datensätze ohne Feld; keine Closing-Line-Erfassung. | Robust gefiltert; Closing Odds/No-Vig/CLV je Recommendation. | ✅ |
| F25 | Modellqualität | Feature-Modell ist naiv: kein Ligadurchschnitt, Heim/Auswärts nicht getrennt, keine Gegnerstärke, kein Zeitverfall, kein Dixon-Coles-rho, keine Kalibrierung. | Dokumentiert; siehe Roadmap Phase 3. | ⛔ |
| F26 | Plattform-Laufzeit | Kompletter Zyklus läuft sequenziell in einem Worker – Zeit-/CPU-Limits unbekannt. | Ggf. in Schritte aufteilen. | ⛔ ohne Plattform nicht prüfbar |

### P2 – mittel

| ID | Befund | Status |
|---|---|---|
| F27 | `searchEvents` übergab Nutzertext als Regex (Regex-Injection/ReDoS). → escaped. | ✅ |
| F28 | `importApostaEvent` mit `z.any()`, `syncNow` mit beliebigem Job-String. → Größenlimit, Enum. | ✅ |
| F29 | Ein API-Football-Request pro Event (Ratenlimit). → Cache je Datum und Lauf. | ✅ |
| F30 | Provider-Fehlertexte (evtl. mit Endpunkt-URL/Token) für alle Nutzer lesbar. → `ProviderHealth` Lesen nur Admin, Server-Funktion maskiert. | ✅ |
| F31 | Entitäten mit `rls.read: {}` (u. a. `ValueSignal`, `Prediction`) sind über das Client-SDK direkt lesbar. Die Gates sind Anzeige-, keine Zugriffskontrolle; unveröffentlichte Signale sind technisch einsehbar. | ⛔ Produktentscheidung |
| F32 | AET/PEN/Wertungen werden nicht automatisch abgerechnet; es fehlt eine Admin-Oberfläche für Review-Fälle. | ⛔ |
| F33 | ESLint-Konfiguration fehlte (`npm run lint` brach ab). → Flat-Config. | ✅ |
| F34 | Kein CI für `aposta-edge/` im Repository; GitHub-Pages-Workflow veröffentlicht das gesamte Repo inkl. Quellcode (keine Secrets enthalten). | ⛔ |

### P3 – niedrig

F35 Admin-Link für alle sichtbar (Server prüft Rolle) · F36 Zeitanzeige `en-US` statt `es-PY` · F37 „degraded“ vs. „offline“ bei Aposta-Fehlern uneinheitlich (unkonfiguriert wird korrekt unterschieden) · F38 Event-Detail zeigt keine Team-Statistiken mehr je Event (Statistiken sind jetzt teambezogen; Feature-Snapshot steht in der Prognose).

---

## F. Externe Zugänge und Datenquellen

| Komponente | Benötigt | Zustand |
|---|---|---|
| Aposta-Events/-Quoten | `APOSTA_EVENTS_ENDPOINT`, `APOSTA_ODDS_ENDPOINT` (eigenes JSON-Schema, `complete: true`) | Kein Nachweis, dass ein solcher Endpunkt existiert oder rechtlich nutzbar ist |
| Fixtures, Statistiken, Ergebnisse, Aufstellungen | `API_FOOTBALL_KEY` | Nicht verifiziert; Abdeckung der paraguayischen Ligen und Kontingent prüfen |
| Scheduler | `CRON_SECRET` + externer/Base44-Zeitplan | Nicht eingerichtet |
| KI-Analyst | Base44 AI-Gateway | Plattformseitig, nicht getestet |

**Aposta-Daten ohne Scraping – realistische Optionen**
1. Bei Aposta.la einen offiziellen Daten-/Affiliate-Feed oder eine schriftliche Nutzungserlaubnis anfragen (bevorzugt). Der Adapter erwartet nur ein dokumentiertes JSON-Format; ein Mapping auf ein echtes Partnerformat ist wenig Aufwand.
2. Bis dahin: manueller Import **mit** `source_timestamp` und Admin-Bestätigung („Verified on aposta.la“). Das ist für einen öffentlichen Dienst nicht skalierbar und nur für eine kleine geschlossene Testphase geeignet.
3. Für die **Modellvalidierung** (nicht für Aposta-Empfehlungen) können lizenzierte historische Quoten anderer Buchmacher als Marktbenchmark und Closing-Line-Referenz dienen – klar als „nicht Aposta“ gekennzeichnet. Welche Anbieter paraguayische Ligen abdecken, ist vor einem Vertrag zu prüfen.

Ohne Option 1 kann die App keine echten Aposta-Value-Empfehlungen öffentlich und automatisiert anbieten.

---

## G. Roadmap bis zur Veröffentlichung

| Phase | Inhalt | Abhängigkeit | Aufwand (grob) |
|---|---|---|---|
| 0 – Plattform-Verifikation | Branch auf Base44 bauen und deployen; Entitäts-Migration (neue Felder); SDK-Semantik prüfen (`$in` auf `id`, gepunktete Pfade, `skip`); Worker-Laufzeit des Zyklus messen; CI-Workflow für `aposta-edge/` (install, lint, test) | Base44-Zugang | 2–4 Tage |
| 1 – Datenzugang | Aposta-Feed/Erlaubnis klären; API-Football-Key, Abdeckung PY-Ligen, Kontingent; Scheduler (`CRON_SECRET`) einrichten; Provider-Antworten als Fixtures für Vertragstests aufzeichnen | Aposta, API-Football | 1–3 Wochen (extern bestimmt) |
| 2 – Historische Daten | ≥ 2–3 Saisons Ergebnisse pro Zielliga; historische Quoten mit Zeitstempeln; Import in Backtest-Format | Phase 1 | 1–2 Wochen |
| 3 – Modell | Ligadurchschnitt + Heim/Auswärts-Stärken (Maher/Dixon-Coles mit Zeitverfall, MLE inkl. rho); Elo-Update-Job; Kalibrierung auf Validierungsdaten; Vergleich gegen Uniform- und Markt-Baseline | Phase 2 | 2–4 Wochen |
| 4 – Validierung | Walk-Forward auf Entwicklungsdaten, **einmaliger** Holdout-Lauf, Bericht ablegen, dann `setModelValidation`. Freigabe nur, wenn Log-Loss/Brier besser als Markt-Baseline bzw. CLV > 0 bei ausreichender Stichprobe | Phase 3 | 1 Woche + Laufzeit |
| 5 – Betrieb | Monitoring/Alerting auf SyncRun-Fehler, Review-UI (AET/PEN, Mapping-Konflikte), Rollback-Prozess (Tag + Base44-Versionen), RLS-Entscheidung zu F31 | Phase 0 | 1–2 Wochen |
| 6 – Frontend | Spanisch, Ligafilter, mobile Spielkarten, Kalibrierungsdiagramm, „Prognose des Tages“ nur bei veröffentlichtem Signal, Verantwortungs-/Risikohinweise | parallel ab Phase 0 | 1–2 Wochen |

Realistisch frühestens 8–12 Wochen bis zu einem öffentlichen, belastbaren MVP – **vorausgesetzt**, ein rechtmäßiger Aposta-Datenzugang wird erreicht.

---

## H. Umgesetzte Korrekturen (dieser Branch)

Neue Module: `src/lib/server/modelInputs.js`, `src/lib/server/valueSignals.js`, `src/lib/metrics.js`, `src/lib/server/backtest.js`, `src/routes/api/cron.cycle.js`.
Wesentlich geändert: `syncPipeline.server.js`, `provenance.js`, `signalFilter.js`, `eventMatcher.js`, `predictionEngine.js`, `server-fns.js`, `edgeAiChat.js`, Event-Detail-, Performance- und Admin-Seite, 10 Entitätsschemata, Agent-Konfiguration, `package.json` (+ Lockfile), `eslint.config.js`.
Neue Tests: `modelAndValue.test.js` (17), `metricsBacktest.test.js` (15), `pipelineIntegrity.test.js` (22); angepasst: `provenance.test.js`, `predictionEngine.test.js` (nur dort, wo die Regel bewusst verschärft wurde).

**Migrationshinweise:** Bestehende Datensätze erfüllen die neuen Gates nicht (z. B. fehlende `odds_observed_at`, `computation_status`, `validation_status`) und werden deshalb **nicht** veröffentlicht – gewollt. Nach dem Deploy einen vollständigen Zyklus laufen lassen. Manuelle Importe müssen erneut bestätigt werden.

---

## I. Verbleibende Blocker für den öffentlichen Start

1. Kein rechtmäßiger, technisch nachgewiesener Aposta-Livezugang.
2. Modell nicht validiert und nicht kalibriert; es gibt keine historischen Daten im System → derzeit **zu Recht keine veröffentlichten Empfehlungen**.
3. Build/Deploy auf Base44 mit diesem Branch nicht verifiziert; kein CI, kein Scheduler, kein Rollback-Prozess.
4. Rechtliches (Glücksspiel-Werbung, Jugendschutz, Haftungshinweise in Paraguay) nicht geprüft – außerhalb des Codes.

---

## J. Nächster Arbeitsauftrag (unmittelbar ausführbar)

> **Phase 0 + Datenaufnahme für Backtests.**
> 1. Branch `claude/aposta-edge-audit` in Base44 deployen; die geänderten Entitätsschemata übernehmen; berichten, ob Build und Deploy gelingen. Falls nicht: die Fehlermeldung des Base44-Builds liefern.
> 2. In der Base44-Umgebung `API_FOOTBALL_KEY` und `CRON_SECRET` setzen; über Admin „Test Connections“ und „Run Full Cycle“ ausführen und die SyncRun-Details (ohne Secrets) zurückmelden.
> 3. Mir mitteilen: (a) Zielligen (z. B. Paraguay Primera División, Libertadores, …) und (b) ob eine Anfrage an Aposta.la für einen Daten-Feed gestellt wird.
> 4. Danach implementiere ich: einen CI-Workflow für `aposta-edge/`; einen Import historischer API-Football-Ergebnisse (≥ 2 Saisons, Zielligen) in das Backtest-Format; einen Admin-Endpunkt, der den Backtest ausführt und den Bericht unveränderlich speichert; sowie das Ligamodell (Angriff/Abwehr, Heimvorteil, Zeitverfall, MLE-rho) mit Vergleich gegen die jetzige Baseline. Die Freigabe (`validated`) erfolgt erst nach dem einmaligen Holdout-Lauf.

---

### Lokale Ausführung

```bash
cd aposta-edge
npm ci          # oder npm install
npm test        # 152 Tests
npm run lint
```
