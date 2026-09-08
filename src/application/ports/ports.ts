import type { Result } from "../../shared/result/result";
import type { InstantString } from "../../domain/primitives/instant";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { Sha256Hex } from "../../domain/primitives/hash";
import type { SchemaVersion } from "../../domain/primitives/versioning";
import type {
  CaseEvaluationId,
  EvaluationBundleId,
  UserCaseId,
  UserId,
} from "../../domain/identifiers/identifiers";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { CaseEvaluationDecision } from "../../domain/evaluation/decision";
import type { EvaluationBundleContent } from "../../rules/bundle/bundle-content";

/**
 * Ports.
 *
 * The application layer talks to these interfaces only. Adapters live in
 * `src/infrastructure`, and the architecture test forbids this layer from
 * importing them - which is what keeps Supabase, `pg` and Next out of the
 * business logic.
 */
export type PortError = Readonly<{
  kind: "PORT_ERROR";
  code:
    | "NOT_FOUND"
    | "NOT_AUTHORIZED"
    | "CONFLICT"
    | "UNAVAILABLE"
    | "INVARIANT_VIOLATION";
  detail: string;
}>;

/** The engine never reads a clock; this is the only place time enters. */
export type ClockPort = Readonly<{
  nowInstant: () => InstantString;
}>;

export type HashPort = Readonly<{
  canonicalHash: (value: unknown) => Sha256Hex;
}>;

/**
 * Reads the published knowledge that is effective on one specific date, in a
 * single REPEATABLE READ snapshot.
 */
export type KnowledgeReadPort = Readonly<{
  loadBundleContentFor: (
    effectiveLocalDate: LocalDate,
  ) => Promise<Result<EvaluationBundleContent, PortError>>;
}>;

export type EvaluationBundleStorePort = Readonly<{
  materialize: (
    contentHash: Sha256Hex,
    schemaVersion: SchemaVersion,
    content: EvaluationBundleContent,
  ) => Promise<Result<EvaluationBundleId, PortError>>;
}>;

export type StoredUserCase = Readonly<{
  userCaseId: UserCaseId;
  ownerUserId: UserId;
  facts: UserCaseFacts;
}>;

export type UserCaseRepositoryPort = Readonly<{
  findOwnedById: (
    userCaseId: UserCaseId,
    ownerUserId: UserId,
  ) => Promise<Result<StoredUserCase, PortError>>;
  save: (
    ownerUserId: UserId,
    facts: UserCaseFacts,
    userCaseId: UserCaseId | null,
  ) => Promise<Result<UserCaseId, PortError>>;
  erase: (userCaseId: UserCaseId) => Promise<Result<void, PortError>>;
}>;

export type RecordEvaluationInput = Readonly<{
  userCaseId: UserCaseId;
  evaluatedAt: InstantString;
  jurisdictionTimeZone: string;
  effectiveLocalDate: LocalDate;
  engineVersion: string;
  inputSchemaVersion: SchemaVersion;
  inputHash: Sha256Hex;
  inputSnapshot: UserCaseFacts;
  evaluationBundleId: EvaluationBundleId;
  evaluationSchemaVersion: SchemaVersion;
  decision: CaseEvaluationDecision;
}>;

export type CaseEvaluationRepositoryPort = Readonly<{
  record: (input: RecordEvaluationInput) => Promise<Result<CaseEvaluationId, PortError>>;
  listForCase: (
    userCaseId: UserCaseId,
  ) => Promise<Result<readonly Readonly<{ id: CaseEvaluationId; decision: CaseEvaluationDecision }>[], PortError>>;
}>;
