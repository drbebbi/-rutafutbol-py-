/* RutaFútbol PY – Service Worker.
   App-Shell precacheada + caché en tiempo de ejecución para Leaflet (unpkg),
   de modo que el mapa también funcione sin conexión tras la primera visita. */

const CACHE = 'rutafutbol-py-v4';
const RUNTIME = 'rutafutbol-py-runtime-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './data.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE && key !== RUNTIME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Navegaciones: red primero, con la App-Shell como reserva sin conexión.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Leaflet desde unpkg: caché primero para que el mapa funcione sin conexión.
  if (url.origin === 'https://unpkg.com') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then(cache => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Otros orígenes (p. ej. teselas de OpenStreetMap): comportamiento normal
  // del navegador, sin caché propia para no acumular datos sin límite.
  if (!sameOrigin) return;

  // Recursos propios: caché primero, luego red.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
