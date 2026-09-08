import type { Result } from "../../shared/result/result";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { Sha256Hex } from "../../domain/primitives/hash";
import type { RuleRevisionId, UserId } from "../../domain/identifiers/identifiers";
import type { PortError } from "../ports/ports";
import type { StalePublication } from "./publication-validation-service";

export type PublishRuleRevisionInput = Readonly<{
  /** The administrator performing the publication, as the server verified them. */
  actorUserId: UserId;
  ruleRevisionId: RuleRevisionId;
  validFrom: LocalDate;
  /** The hash the validation run produced and a publisher approved. */
  approvedCandidateBundleHash: Sha256Hex;
}>;

export type PublicationFailure =
  | Readonly<{ kind: "STALE"; detail: StalePublication }>
  | Readonly<{ kind: "PORT"; error: PortError }>;

/**
 * Publishing an approved rule revision.
 *
 * The port takes what was approved and nothing about what the candidate is
 * *now*. That asymmetry is the point: a caller that could state both halves of
 * the staleness comparison would always find them equal, so the drift check
 * has to be made by the transaction that publishes, against the knowledge base
 * it has locked.
 */
export type RulePublicationPort = Readonly<{
  publish: (input: PublishRuleRevisionInput) => Promise<Result<Sha256Hex, PublicationFailure>>;
}>;
