import type { RuleId, RuleRevisionId, SourceRevisionId } from "../identifiers/identifiers";

/**
 * Where an authoritative statement came from.
 *
 * Provenance survives merges: when two rules support the same consequence, the
 * merged result keeps both rules' provenance, deduplicated and lexically
 * sorted so the output is reproducible.
 */
export type ProvenanceRef = Readonly<{
  ruleId: RuleId;
  ruleRevisionId: RuleRevisionId;
  sourceRevisionIds: readonly SourceRevisionId[];
}>;
