/**
 * Retention policy.
 *
 * These are INITIAL TECHNICAL DEFAULTS. They are not, and must not be presented
 * as, statutory retention periods - no such period has been established for
 * this product.
 *
 * The knowledge publication audit is deliberately not on a 365-day clock: it is
 * the only record of what the knowledge base said and when, and a stored
 * evaluation from three years ago is unexplainable without it.
 */
export type RetentionClass =
  | "OPERATIONAL_LOG"
  | "SECURITY_ABUSE_LOG"
  | "SECURITY_AUTHORIZATION_AUDIT"
  | "KNOWLEDGE_PUBLICATION_AUDIT"
  | "USER_CASE_DATA";

export type RetentionRule = Readonly<{
  retentionClass: RetentionClass;
  /** `null` means "retained for as long as the knowledge base is auditable". */
  retentionDays: number | null;
  rationale: string;
}>;

export const RETENTION_POLICY: readonly RetentionRule[] = [
  {
    retentionClass: "OPERATIONAL_LOG",
    retentionDays: 30,
    rationale: "Enough to debug an incident; short enough to limit exposure.",
  },
  {
    retentionClass: "SECURITY_ABUSE_LOG",
    retentionDays: 90,
    rationale: "Abuse patterns are only visible over weeks.",
  },
  {
    retentionClass: "SECURITY_AUTHORIZATION_AUDIT",
    retentionDays: 365,
    rationale: "Initial default for reconstructing who held which authority.",
  },
  {
    retentionClass: "KNOWLEDGE_PUBLICATION_AUDIT",
    retentionDays: null,
    rationale:
      "Rule, source, fee and coverage history must stay reconstructable: a stored evaluation cannot be explained without the knowledge it was decided against.",
  },
  {
    retentionClass: "USER_CASE_DATA",
    retentionDays: null,
    rationale: "Kept while the user keeps the case; removed on their request.",
  },
];

export function retentionFor(retentionClass: RetentionClass): RetentionRule {
  const found = RETENTION_POLICY.find((rule) => rule.retentionClass === retentionClass);
  /* v8 ignore next 3 -- the policy list is exhaustive over the union. */
  if (found === undefined) {
    throw new Error(`no retention rule for ${retentionClass}`);
  }
  return found;
}
