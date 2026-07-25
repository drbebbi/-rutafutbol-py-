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

Das Repository enthält den Workflow `.github/workflows/pages.yml`.

Nach dem ersten Push auf `main`:

1. Repository öffnen.
2. **Settings → Pages** öffnen.
3. Unter **Build and deployment** als Quelle **GitHub Actions** auswählen.
4. Den Workflow unter **Actions** abwarten.

Beim aktuellen Repository-Namen lautet die Seite voraussichtlich:

`https://drbebbi.github.io/-rutafutbol-py-/`

Nach einer Umbenennung auf `rutafutbol-py` lautet sie:

`https://drbebbi.github.io/rutafutbol-py/`

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
