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
