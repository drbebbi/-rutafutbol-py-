import "server-only";
import { err, ok } from "../../../shared/result/result";
import type { Sha256Hex } from "../../../domain/primitives/hash";
import { evaluationBundleContentHash } from "../../../rules/bundle/canonical-bundle";
import type {
  PublicationFailure,
  PublishRuleRevisionInput,
  RulePublicationPort,
} from "../../../application/rules/publication-service";
import { openInternalConnection, type Tx } from "../../database/connection";
import { loadBundleContentInTransaction } from "../public-read/knowledge-read-adapter";

/**
 * The publication transaction.
 *
 * One transaction does all four things, in this order, and nothing can slip
 * between them:
 *
 *  1. take the publication advisory lock, so no other publication can move the
 *     knowledge base underneath this one;
 *  2. assemble the candidate as it would be once the approved revision goes
 *     live, using the same production assembly the runtime uses;
 *  3. hash it with the production hashing and compare against the approval;
 *  4. publish, which re-checks the same comparison in the database and writes
 *     the audit event.
 *
 * The caller never states what the candidate currently hashes to. It says only
 * what it approved, and this transaction works out the rest - which is the
 * only arrangement in which a staleness check can fail.
 */
/**
 * The hash a publisher approves.
 *
 * The same assembly and the same hashing the publication transaction will
 * redo under its lock, so an approval and the later verification are
 * comparable by construction rather than by two code paths agreeing.
 */
export async function computeCandidateBundleHash(
  connectionString: string,
  input: Pick<PublishRuleRevisionInput, "ruleRevisionId" | "validFrom">,
): Promise<Sha256Hex | null> {
  const sql = openInternalConnection(connectionString);
  let hash: Sha256Hex | null = null;
  try {
    await sql.begin("isolation level repeatable read", async (tx: Tx) => {
      const candidate = await loadBundleContentInTransaction(tx, input.validFrom, {
        ruleRevisionId: input.ruleRevisionId as string,
      });
      hash = candidate.ok ? evaluationBundleContentHash(candidate.value) : null;
    });
    return hash;
  } finally {
    await sql.end().catch(() => undefined);
  }
}

export function createRulePublicationAdapter(connectionString: string): RulePublicationPort {
  return {
    async publish(input: PublishRuleRevisionInput) {
      const sql = openInternalConnection(connectionString);
      let outcome: Awaited<ReturnType<RulePublicationPort["publish"]>> | null = null;
      try {
        await sql.begin(async (tx: Tx) => {
          outcome = await publishInTransaction(tx, input);
        });
        return (
          outcome ??
          err<PublicationFailure>({
            kind: "PORT",
            error: {
              kind: "PORT_ERROR",
              code: "UNAVAILABLE",
              detail: "the publication transaction produced no result",
            },
          })
        );
      } catch (error) {
        const detail = String(error);
        return err<PublicationFailure>({
          kind: "PORT",
          error: {
            kind: "PORT_ERROR",
            code: detail.includes("not authorized")
              ? "NOT_AUTHORIZED"
              : detail.includes("STALE_PUBLICATION_VALIDATION")
                ? "INVARIANT_VIOLATION"
                : "UNAVAILABLE",
            detail,
          },
        });
      } finally {
        await sql.end().catch(() => undefined);
      }
    },
  };
}

async function publishInTransaction(
  tx: Tx,
  input: PublishRuleRevisionInput,
): Promise<Awaited<ReturnType<RulePublicationPort["publish"]>>> {
  await tx`select pg_advisory_xact_lock(hashtext('cedula.publication'))`;

  const candidate = await loadBundleContentInTransaction(tx, input.validFrom, {
    ruleRevisionId: input.ruleRevisionId as string,
  });
  if (!candidate.ok) {
    return err<PublicationFailure>({ kind: "PORT", error: candidate.error });
  }

  const actual = evaluationBundleContentHash(candidate.value);
  if ((actual as string) !== (input.approvedCandidateBundleHash as string)) {
    return err<PublicationFailure>({
      kind: "STALE",
      detail: {
        kind: "STALE_PUBLICATION_VALIDATION",
        approved: input.approvedCandidateBundleHash,
        actual,
      },
    });
  }

  await tx`
    select core.publish_rule_revision(
      ${input.actorUserId as string}::uuid,
      ${input.ruleRevisionId as string}::uuid,
      ${input.validFrom as string}::date,
      ${input.approvedCandidateBundleHash as string},
      ${actual as string}
    )`;

  return ok<Sha256Hex>(actual);
}
