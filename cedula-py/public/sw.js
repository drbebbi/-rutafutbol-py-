/*
 * Minimal service worker.
 *
 * Caches the application shell and nothing else. Private cases, auth responses
 * and legal knowledge are always fetched from the network - see
 * src/pwa/cache/cache-policy.ts for why.
 */
const SHELL_CACHE = "cedula-py-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isPrivate =
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/case") ||
    url.pathname.startsWith("/admin");

  if (event.request.method !== "GET" || isPrivate) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
