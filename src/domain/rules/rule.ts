import type { RuleId, RuleSetId } from "../identifiers/identifiers";

/** Stable identity of a rule. Revisions carry the content. */
export type Rule = Readonly<{
  ruleId: RuleId;
  ruleSetId: RuleSetId;
  /** Stable machine label for reviewers; not user-facing copy. */
  label: string;
}>;

export type RuleSet = Readonly<{
  ruleSetId: RuleSetId;
  label: string;
}>;
