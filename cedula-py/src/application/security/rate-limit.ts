/**
 * Risk-based rate limiting.
 *
 * The categories differ by what an attacker gains from volume: credential
 * stuffing on AUTH, knowledge scraping and cost on evaluation, and blast radius
 * on the administrative categories.
 */
export type RateLimitCategory =
  | "AUTH"
  | "ANONYMOUS_EVALUATION"
  | "AUTHENTICATED_EVALUATION"
  | "CASE_MUTATION"
  | "ADMIN_READ"
  | "ADMIN_WRITE"
  | "RULE_PUBLICATION";

export const RATE_LIMIT_CATEGORIES: readonly RateLimitCategory[] = [
  "AUTH",
  "ANONYMOUS_EVALUATION",
  "AUTHENTICATED_EVALUATION",
  "CASE_MUTATION",
  "ADMIN_READ",
  "ADMIN_WRITE",
  "RULE_PUBLICATION",
];

export type RateLimitPolicy = Readonly<{
  category: RateLimitCategory;
  windowSeconds: number;
  maxRequests: number;
  keyedBy: "IP" | "USER" | "IP_AND_USER";
}>;

/**
 * Initial technical defaults. These are engineering limits, not a claim about
 * any legal or contractual requirement.
 */
export const RATE_LIMIT_POLICIES: readonly RateLimitPolicy[] = [
  { category: "AUTH", windowSeconds: 300, maxRequests: 10, keyedBy: "IP" },
  { category: "ANONYMOUS_EVALUATION", windowSeconds: 60, maxRequests: 20, keyedBy: "IP" },
  { category: "AUTHENTICATED_EVALUATION", windowSeconds: 60, maxRequests: 60, keyedBy: "USER" },
  { category: "CASE_MUTATION", windowSeconds: 60, maxRequests: 60, keyedBy: "USER" },
  { category: "ADMIN_READ", windowSeconds: 60, maxRequests: 120, keyedBy: "USER" },
  { category: "ADMIN_WRITE", windowSeconds: 60, maxRequests: 30, keyedBy: "USER" },
  { category: "RULE_PUBLICATION", windowSeconds: 3600, maxRequests: 10, keyedBy: "USER" },
];

export function policyFor(category: RateLimitCategory): RateLimitPolicy {
  const found = RATE_LIMIT_POLICIES.find((policy) => policy.category === category);
  /* v8 ignore next 3 -- the policy list is exhaustive over the union. */
  if (found === undefined) {
    throw new Error(`no rate limit policy for ${category}`);
  }
  return found;
}
