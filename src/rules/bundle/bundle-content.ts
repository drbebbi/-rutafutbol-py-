import type { SchemaVersion } from "../../domain/primitives/versioning";
import type { Sha256Hex } from "../../domain/primitives/hash";
import type { InstantString } from "../../domain/primitives/instant";
import type { EvaluationBundleId } from "../../domain/identifiers/identifiers";
import type { SourceRevision } from "../../domain/sources/source";
import type { FeeIndexRevision } from "../../domain/fees/fee";
import type {
  PathwayDefinitionRevision,
  ProductCoverageRevision,
  ProductPolicyRevision,
} from "../../domain/product/product";
import type { RuleRevision, RuleSetRevision } from "../definitions/rule-revision";

export const EVALUATION_BUNDLE_SCHEMA_VERSION = "evaluation-bundle@1.0" as SchemaVersion;

/**
 * The immutable, decision-affecting content of an evaluation bundle.
 *
 * Everything the engine could possibly read is in here, and nothing else is.
 * In particular `firstMaterializedAt` is deliberately *not* part of the
 * content: when it was first stored has no bearing on what the law said, so
 * including it would make identical knowledge hash differently.
 */
export type EvaluationBundleContent = Readonly<{
  schemaVersion: SchemaVersion;
  ruleSetRevisions: readonly RuleSetRevision[];
  ruleRevisions: readonly RuleRevision[];
  evidence: readonly SourceRevision[];
  feeIndexRevisions: readonly FeeIndexRevision[];
  productPolicyRevisions: readonly ProductPolicyRevision[];
  productCoverageRevisions: readonly ProductCoverageRevision[];
  pathwayDefinitionRevisions: readonly PathwayDefinitionRevision[];
}>;

/** The stored record. Content plus the bookkeeping the content must not carry. */
export type EvaluationBundleRecord = Readonly<{
  evaluationBundleId: EvaluationBundleId;
  contentHash: Sha256Hex;
  schemaVersion: SchemaVersion;
  content: EvaluationBundleContent;
  firstMaterializedAt: InstantString;
}>;
