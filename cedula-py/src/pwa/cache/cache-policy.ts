import { isCacheableOffline, type CacheScope } from "../registration/register-service-worker";

export type CachePolicy = Readonly<{
  scope: CacheScope;
  strategy: "NETWORK_ONLY" | "CACHE_FIRST" | "STALE_WHILE_REVALIDATE";
  rationale: string;
}>;

/**
 * The offline policy for this release.
 *
 * Only the shell is cached. Everything that can be wrong offline - a private
 * case, an auth response, a legal requirement - is network-only until a later
 * phase decides how staleness should be communicated to the user.
 */
export const CACHE_POLICIES: readonly CachePolicy[] = [
  {
    scope: "APP_SHELL",
    strategy: "CACHE_FIRST",
    rationale: "Static shell; nothing user-specific and nothing legally meaningful.",
  },
  {
    scope: "PRIVATE_CASE",
    strategy: "NETWORK_ONLY",
    rationale: "Personal high-risk data must not sit in a device cache by default.",
  },
  {
    scope: "AUTH_RESPONSE",
    strategy: "NETWORK_ONLY",
    rationale: "A cached auth response is a replayable session.",
  },
  {
    scope: "LEGAL_KNOWLEDGE",
    strategy: "NETWORK_ONLY",
    rationale: "An out-of-date legal answer is worse than no answer.",
  },
];

export function policyFor(scope: CacheScope): CachePolicy {
  const found = CACHE_POLICIES.find((policy) => policy.scope === scope);
  /* v8 ignore next 3 -- the policy list is exhaustive over the union. */
  if (found === undefined) {
    throw new Error(`no cache policy for ${scope}`);
  }
  return found;
}

export function offlineAllowed(scope: CacheScope): boolean {
  return isCacheableOffline(scope);
}
