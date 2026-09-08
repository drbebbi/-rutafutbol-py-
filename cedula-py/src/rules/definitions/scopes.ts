/**
 * Rule scopes (version 1).
 *
 * Exactly one explicit scope per rule; no nested foreach. A rule that needs to
 * talk about two collections at once is a modelling problem, not a language
 * problem, and would make conflict analysis intractable.
 */
export type RuleScope =
  | "CASE"
  | "EACH_NATIONALITY"
  | "EACH_RESIDENCE_HISTORY_ENTRY"
  | "EACH_DOCUMENT_INSTANCE";

export const RULE_SCOPES: readonly RuleScope[] = [
  "CASE",
  "EACH_NATIONALITY",
  "EACH_RESIDENCE_HISTORY_ENTRY",
  "EACH_DOCUMENT_INSTANCE",
];

import type { FactPathScope } from "./fact-paths";

/** Which path scopes a rule of the given scope may read. */
export function allowedPathScopesFor(scope: RuleScope): readonly FactPathScope[] {
  switch (scope) {
    case "CASE":
      return ["CASE", "CONTEXT"];
    case "EACH_NATIONALITY":
      return ["CASE", "CONTEXT", "NATIONALITY"];
    case "EACH_RESIDENCE_HISTORY_ENTRY":
      return ["CASE", "CONTEXT", "RESIDENCE_HISTORY"];
    case "EACH_DOCUMENT_INSTANCE":
      return ["CASE", "CONTEXT", "DOCUMENT"];
  }
}
