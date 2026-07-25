# RutaFútbol PY

Mobile-first Progressive Web App für den paraguayischen Fußball.
Statische Website ohne Build-Prozess – direkt auf GitHub Pages deploybar.

## Enthalten

- Torneo Clausura 2026, Spieltage 1–3
- 18 Spiele, 12 Vereine, 12 Stadien
- Suche und Spieltagsfilter
- Leaflet-Karte (bei Bedarf geladen) mit Google-Maps-Navigation
- Spiel- und Stadiondetails
- lokaler Fußballpass („Pasaporte") via `localStorage`
- installierbare PWA (Android-Install-Prompt, iOS-Anleitung)
- Offline-App-Shell über Service Worker
- automatisches Deployment über GitHub Actions

## Projektstruktur

```
index.html                    App-Shell (Kopfzeile, Navigation, Dialog)
app.js                        Gesamte App-Logik (Vanilla JS, IIFE)
data.js                       Spiel-, Stadion- und Vereinsdaten (window.RUTA_DATA)
styles.css                    Mobile-first Styles
sw.js                         Service Worker (Precache + Laufzeit-Cache für Leaflet)
manifest.webmanifest          PWA-Manifest
404.html                      Eigenständige Redirect-Seite für GitHub Pages
icons/                        App-Icons (192, 512, Apple Touch)
robots.txt, .nojekyll         Statische Konfiguration
.github/workflows/pages.yml   Deployment-Workflow
```

## Lokal testen

Eine PWA benötigt HTTP oder HTTPS; direktes Öffnen per `file://` reicht nicht
(dann erscheinen nur Kopfzeile und Navigation, weil Skripte blockiert werden können
und Service Worker/Manifest nicht funktionieren).

```bash
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Alternativ:

```bash
npx serve .
```

Zum Testen auf dem iPhone im selben WLAN: `http://<IP-des-Rechners>:8080`
(ohne HTTPS ist der Service Worker deaktiviert, die App selbst läuft trotzdem).

## GitHub Pages

Die Seite ist erreichbar unter:

`https://drbebbi.github.io/-rutafutbol-py-/`

### Wie das Deployment funktioniert

Pages läuft für dieses Repository im **Branch-Modus** und veröffentlicht den
Branch `gh-pages`. Der Workflow `.github/workflows/pages.yml` spiegelt bei
jedem Push auf `main` den aktuellen Stand nach `gh-pages`; GitHub baut die
Seite danach automatisch (sichtbar unter Actions als
„pages build and deployment").

Arbeitsablauf im Alltag: **immer auf `main` arbeiten.** Der Branch `gh-pages`
ist reines Veröffentlichungsziel und wird vom Workflow überschrieben – dort
niemals von Hand committen.

### Warum nicht `actions/deploy-pages`

Der übliche Weg über `actions/configure-pages` und `actions/deploy-pages`
setzt voraus, dass unter **Settings → Pages** als Quelle **GitHub Actions**
eingestellt ist. Ohne diese Einstellung scheitert er mit
`Get Pages site failed` bzw. `Create Pages site failed: Resource not
accessible by integration` – ein Workflow-Token darf eine Pages-Site nicht
selbst anlegen. Der Branch-Weg kommt ohne jede Einstellung aus.

Wer später doch auf den Actions-Modus umstellen möchte: unter
**Settings → Pages → Source** auf **GitHub Actions** wechseln und den
Workflow wieder auf `configure-pages` / `upload-pages-artifact` /
`deploy-pages` umbauen.

Nach einer Umbenennung des Repositories auf `rutafutbol-py` lautet die
Adresse `https://drbebbi.github.io/rutafutbol-py/`; am Code ist dafür nichts
zu ändern, da alle Pfade relativ sind.

Alle Pfade der App sind relativ – sie funktioniert in jedem
Repository-Unterordner ohne Anpassung.

## Datenpflege

Alle Inhalte liegen in `data.js` (`window.RUTA_DATA`):

- `matches` – Spiele mit `id`, `round`, `date`, `time`, Stadionreferenz und Koordinaten
- `stadiums` – Stadien mit `id`, Koordinaten und Google-Maps-Link
- `clubs` – Vereinsliste

Der Pasaporte speichert unter den `localStorage`-Schlüsseln
`ruta-saved-matches` und `ruta-visited-stadiums` jeweils ein Array von IDs.
Diese Schlüssel dürfen nicht umbenannt werden, sonst verlieren Nutzer ihre Daten.

Nach Änderungen an App-Shell-Dateien die Cache-Version in `sw.js`
(`rutafutbol-py-vX`) erhöhen, damit installierte Clients die neue Version erhalten.
