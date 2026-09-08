import { canonicalJsonStringify } from "../../shared/serialization/canonical-json";
import { sha256HexOfUtf8 } from "../../shared/hashing/sha256";
import { sha256HexConstant, type Sha256Hex } from "../../domain/primitives/hash";
import type { EvaluationBundleContent } from "./bundle-content";

/**
 * Canonical ordering of every collection in a bundle.
 *
 * Two bundles that contain the same knowledge must hash identically no matter
 * what order the database happened to return the rows in.
 */
function byKey<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function canonicalizeBundleContent(
  content: EvaluationBundleContent,
): EvaluationBundleContent {
  return {
    schemaVersion: content.schemaVersion,
    ruleSetRevisions: byKey(content.ruleSetRevisions, (r) => r.ruleSetRevisionId as string),
    ruleRevisions: byKey(content.ruleRevisions, (r) => r.ruleRevisionId as string),
    evidence: byKey(content.evidence, (r) => r.sourceRevisionId as string),
    feeIndexRevisions: byKey(content.feeIndexRevisions, (r) => r.feeIndexRevisionId as string),
    productPolicyRevisions: byKey(
      content.productPolicyRevisions,
      (r) => r.productPolicyRevisionId as string,
    ),
    productCoverageRevisions: byKey(
      content.productCoverageRevisions,
      (r) => r.productCoverageRevisionId as string,
    ),
    pathwayDefinitionRevisions: byKey(
      content.pathwayDefinitionRevisions,
      (r) => r.pathwayDefinitionRevisionId as string,
    ),
  };
}

export function canonicalBundleJson(content: EvaluationBundleContent): string {
  return canonicalJsonStringify(canonicalizeBundleContent(content));
}

/**
 * Content hash over decision-affecting content only.
 *
 * Same knowledge, same hash - regardless of row order, array order or when the
 * bundle was first materialised.
 */
export function evaluationBundleContentHash(content: EvaluationBundleContent): Sha256Hex {
  return sha256HexConstant(sha256HexOfUtf8(canonicalBundleJson(content)));
}
