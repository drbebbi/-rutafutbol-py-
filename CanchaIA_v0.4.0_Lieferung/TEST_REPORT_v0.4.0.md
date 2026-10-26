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
