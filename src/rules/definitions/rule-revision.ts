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
import type { RulePayload } from "./payloads";

/** The current rule payload schema version, covering shape *and* semantics. */
export const RULE_PAYLOAD_SCHEMA_VERSION = "rule-payload@2.0" as SchemaVersion;

export type RuleRevision = Readonly<{
  ruleRevisionId: RuleRevisionId;
  ruleId: RuleId;
  ruleSetId: RuleSetId;
  ruleSetRevisionId: RuleSetRevisionId;
  version: RevisionNumber;
  publicationStatus: PublicationStatus;
  /**
   * Evidence quality of this revision.
   *
   * Metadata about the sources, not a decision channel: what the rule *says*
   * lives in `payload.resolution`. The two are kept consistent by the
   * validator - a revision whose evidence is CONFLICTING cannot carry a
   * resolved consequence, and a CONFIRMED one cannot carry a verification
   * request - but the engine reads the resolution, never this field, when it
   * decides whether a consequence exists.
   */
  verificationStatus: VerificationStatus;
  /** Effective window, inclusive on both ends in the domain model. */
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  payloadSchemaVersion: SchemaVersion;
  payload: RulePayload;
  evidence: readonly RuleEvidence[];
}>;

export type RuleSetRevision = Readonly<{
  ruleSetRevisionId: RuleSetRevisionId;
  ruleSetId: RuleSetId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
}>;
