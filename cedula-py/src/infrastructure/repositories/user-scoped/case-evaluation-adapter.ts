import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok } from "../../../shared/result/result";
import type { CaseEvaluationId, UserCaseId } from "../../../domain/identifiers/identifiers";
import type { CaseEvaluationDecision } from "../../../domain/evaluation/decision";
import type {
  CaseEvaluationRepositoryPort,
  PortError,
  RecordEvaluationInput,
} from "../../../application/ports/ports";

/**
 * Evaluations, through the authorized server path.
 *
 * The write goes through `app.record_case_evaluation`, never through an INSERT:
 * the runtime holds no INSERT privilege on the table at all, so a compromised
 * client cannot fabricate a decision and store it as if the engine produced it.
 */
export function createCaseEvaluationAdapter(client: SupabaseClient): CaseEvaluationRepositoryPort {
  return {
    async record(input: RecordEvaluationInput) {
      const result = await client.schema("app").rpc("record_case_evaluation", {
        p_user_case_id: input.userCaseId as string,
        p_evaluated_at: input.evaluatedAt as string,
        p_jurisdiction_time_zone: input.jurisdictionTimeZone,
        p_effective_local_date: input.effectiveLocalDate as string,
        p_engine_version: input.engineVersion,
        p_input_schema_version: input.inputSchemaVersion as string,
        p_input_hash: input.inputHash as string,
        p_input_snapshot: input.inputSnapshot,
        p_evaluation_bundle_id: input.evaluationBundleId as string,
        p_evaluation_schema_version: input.evaluationSchemaVersion as string,
        p_decision: input.decision,
      });

      if (result.error !== null) {
        return err<PortError>({
          kind: "PORT_ERROR",
          code: result.error.message.includes("not authorized") ? "NOT_AUTHORIZED" : "UNAVAILABLE",
          detail: result.error.message,
        });
      }
      return ok(result.data as unknown as CaseEvaluationId);
    },

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
