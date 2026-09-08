/**
 * Knowledge states (Phase 2 decision, final).
 *
 * The distinction between UNKNOWN and UNANSWERED is deliberate:
 *  - UNANSWERED: the wizard has not asked yet, or the user skipped;
 *  - UNKNOWN:    the user was asked and genuinely does not know.
 *
 * Both are *indeterminate* for rule evaluation. Neither may ever collapse to
 * `false`, because "we don't know whether you are married" is not "you are not
 * married". NOT_APPLICABLE is a third thing again: a question that must not be
 * put to this user at all.
 */
export type KnowledgeState = "KNOWN" | "UNKNOWN" | "UNANSWERED" | "NOT_APPLICABLE";

export const KNOWLEDGE_STATES: readonly KnowledgeState[] = [
  "KNOWN",
  "UNKNOWN",
  "UNANSWERED",
  "NOT_APPLICABLE",
];

/** A fact the wizard always has to resolve one way or another. */
export type Fact<T> =
  | Readonly<{ state: "KNOWN"; value: T }>
  | Readonly<{ state: "UNKNOWN" }>
  | Readonly<{ state: "UNANSWERED" }>;

/** A fact that may legitimately not apply to this applicant at all. */
export type OptionalFact<T> = Fact<T> | Readonly<{ state: "NOT_APPLICABLE" }>;

export function knownFact<T>(value: T): Fact<T> {
  return { state: "KNOWN", value };
}

export const unknownFact = { state: "UNKNOWN" } as const;
export const unansweredFact = { state: "UNANSWERED" } as const;
export const notApplicableFact = { state: "NOT_APPLICABLE" } as const;

export function isKnown<T>(fact: OptionalFact<T>): fact is Readonly<{ state: "KNOWN"; value: T }> {
  return fact.state === "KNOWN";
}

/** Reads the value of a known fact, or `null` for every other state. */
export function factValueOrNull<T>(fact: OptionalFact<T>): T | null {
  return fact.state === "KNOWN" ? fact.value : null;
}
