import "server-only";
import { err, ok } from "../../../shared/result/result";
import type { CaseEvaluationId } from "../../../domain/identifiers/identifiers";
import type { PortError, RecordEvaluationInput } from "../../../application/ports/ports";
import type { Result } from "../../../shared/result/result";
import { openInternalConnection } from "../../database/connection";

/**
 * The authoritative evaluation writer.
 *
 * Server-only, and over the internal database connection rather than the Data
 * API. That is the whole point: `app.record_case_evaluation` is not executable
 * by `authenticated` or `anon`, so there is no request a browser can make -
 * with any token, about any case, including its own - that stores a decision.
 * A stored evaluation is therefore always one this server produced.
 *
 * The owner arrives here already verified by the server. The database still
 * checks it against the case, keeps the table append-only and enforces the
 * bundle foreign key, so this path cannot write a decision that contradicts
 * the case it claims to be about.
 */
export function createCaseEvaluationWriter(connectionString: string) {
  return {
    async record(input: RecordEvaluationInput): Promise<Result<CaseEvaluationId, PortError>> {
      const sql = openInternalConnection(connectionString);
      try {
        const rows = await sql<{ id: string }[]>`
          select app.record_case_evaluation(
            ${input.ownerUserId as string}::uuid,
            ${input.userCaseId as string}::uuid,
            ${input.evaluatedAt as string}::timestamptz,
            ${input.jurisdictionTimeZone},
            ${input.effectiveLocalDate as string}::date,
            ${input.engineVersion},
            ${input.inputSchemaVersion as string},
            ${input.inputHash as string},
            ${JSON.stringify(input.inputSnapshot)}::jsonb,
            ${input.evaluationBundleId as string}::uuid,
            ${input.evaluationSchemaVersion as string},
            ${JSON.stringify(input.decision)}::jsonb
          ) as id`;
        const id = rows[0]?.id;
        if (id === undefined) {
          return err<PortError>({
            kind: "PORT_ERROR",
            code: "INVARIANT_VIOLATION",
            detail: "the evaluation writer returned no id",
          });
        }
        return ok(id as CaseEvaluationId);
      } catch (error) {
        const detail = String(error);
        return err<PortError>({
          kind: "PORT_ERROR",
          code: detail.includes("not authorized") ? "NOT_AUTHORIZED" : "UNAVAILABLE",
          detail,
        });
      } finally {
        await sql.end().catch(() => undefined);
      }
    },
  };
}
