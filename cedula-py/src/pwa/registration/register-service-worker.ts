/**
 * Service worker registration.
 *
 * Deliberately conservative for this release: the shell may be cached, and
 * nothing else. Caching a private case, an auth response or legal knowledge
 * offline needs its own phase, its own expiry story and its own review - an
 * out-of-date legal answer served from a cache is worse than no answer.
 */
export const SERVICE_WORKER_PATH = "/sw.js";

export type CacheScope = "APP_SHELL" | "PRIVATE_CASE" | "AUTH_RESPONSE" | "LEGAL_KNOWLEDGE";

export function isCacheableOffline(scope: CacheScope): boolean {
  return scope === "APP_SHELL";
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  void navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => undefined);
}
