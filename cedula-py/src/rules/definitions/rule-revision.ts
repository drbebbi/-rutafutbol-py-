import type {
  RuleId,
  RuleRevisionId,
  RuleSetId,
  RuleSetRevisionId,
} from "../../domain/identifiers/identifiers";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { RevisionNumber, SchemaVersion } from "../../domain/primitives/versioning";
import type { PublicationStatus } from "../../domain/rules/publication";
import type { VerificationStatus } from "../../domain/rules/verification";
import type { RuleEvidence } from "../../domain/sources/source";
import type {
  VerificationCode,
  VerificationTargetKind,
} from "../../domain/evaluation/issues";
import type { RulePayload } from "./payloads";

/** The current rule payload schema version, covering shape *and* semantics. */
export const RULE_PAYLOAD_SCHEMA_VERSION = "rule-payload@1.0" as SchemaVersion;

/**
 * Precedence between rules.
 *
 * Only two relations exist, both explicit and both authored. There is no
 * numeric priority, no automatic specificity, no automatic source recency -
 * every one of those would silently decide a legal conflict on a heuristic.
 */
export type PrecedenceRelation = "EXCEPTION_TO" | "OVERRIDES";

export const PRECEDENCE_RELATIONS: readonly PrecedenceRelation[] = ["EXCEPTION_TO", "OVERRIDES"];

export type PrecedenceEdge = Readonly<{
  relation: PrecedenceRelation;
  /** The rule this rule takes precedence over. */
  overRuleId: RuleId;
}>;

/**
 * What an unresolved rule asks a human to verify.
 *
 * Required whenever `verificationStatus` is CONFLICTING, UNKNOWN or
 * OFFICIAL_VERIFICATION_REQUIRED. The rule states *what needs checking*; it
 * never states a substitute consequence.
 */
export type RuleVerificationDeclaration = Readonly<{
  code: VerificationCode;
  targetKind: VerificationTargetKind;
}>;

export type RuleRevision = Readonly<{
  ruleRevisionId: RuleRevisionId;
  ruleId: RuleId;
  ruleSetId: RuleSetId;
  ruleSetRevisionId: RuleSetRevisionId;
  version: RevisionNumber;
  publicationStatus: PublicationStatus;
  verificationStatus: VerificationStatus;
  /** Effective window, inclusive on both ends in the domain model. */
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  payloadSchemaVersion: SchemaVersion;
  payload: RulePayload;
  precedence: readonly PrecedenceEdge[];
  evidence: readonly RuleEvidence[];
  verification: RuleVerificationDeclaration | null;
}>;

export type RuleSetRevision = Readonly<{
  ruleSetRevisionId: RuleSetRevisionId;
  ruleSetId: RuleSetId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
}>;
