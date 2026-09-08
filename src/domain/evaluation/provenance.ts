import type { RuleId, RuleRevisionId, SourceRevisionId } from "../identifiers/identifiers";
import type {
  ProductCoverageProvenance,
  ProductPolicyProvenance,
} from "../product/product";

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

/**
 * Every kind of decision provenance in one place.
 *
 * Legal statements, product policy effects and product coverage decisions each
 * carry their own shape, and they are kept apart rather than flattened into
 * one "provenance" bag: a reader must never be able to mistake a product scope
 * decision for a statement about the law.
 */
export type DecisionProvenance = Readonly<{
  rules: readonly ProvenanceRef[];
  productPolicies: readonly ProductPolicyProvenance[];
  productCoverages: readonly ProductCoverageProvenance[];
}>;

export const EMPTY_DECISION_PROVENANCE: DecisionProvenance = {
  rules: [],
  productPolicies: [],
  productCoverages: [],
};
