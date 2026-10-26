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
