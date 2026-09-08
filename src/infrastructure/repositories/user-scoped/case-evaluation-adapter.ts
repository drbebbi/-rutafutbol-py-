import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok } from "../../../shared/result/result";
import type { CaseEvaluationId, UserCaseId } from "../../../domain/identifiers/identifiers";
import type { CaseEvaluationDecision } from "../../../domain/evaluation/decision";
import type { CaseEvaluationRepositoryPort, PortError } from "../../../application/ports/ports";
import { createCaseEvaluationWriter } from "../internal/case-evaluation-writer";

/**
 * A user's evaluations: read through their own session, written server-side.
 *
 * The read is a request-scoped Data API query, so row level security decides
 * what the user may see. The write is not: it runs over the internal database
 * connection as the runtime role, because `app.record_case_evaluation` is not
 * executable by a browser role at all. A stored evaluation is therefore always
 * one this server produced, never one a client asked for.
 */
export function createCaseEvaluationAdapter(
  client: SupabaseClient,
  connectionString: string,
): CaseEvaluationRepositoryPort {
  const writer = createCaseEvaluationWriter(connectionString);
  return {
    record: (input) => writer.record(input),

    async listForCase(userCaseId: UserCaseId) {
      const result = await client
        .schema("app")
        .from("case_evaluations")
        .select("id, decision_jsonb")
        .eq("user_case_id", userCaseId as string)
        .order("created_at", { ascending: false });

      if (result.error !== null) {
        return err<PortError>({ kind: "PORT_ERROR", code: "UNAVAILABLE", detail: result.error.message });
      }
      return ok(
        (result.data as { id: string; decision_jsonb: unknown }[]).map((row) => ({
          id: row.id as CaseEvaluationId,
          decision: row.decision_jsonb as CaseEvaluationDecision,
        })),
      );
    },
  };
}
