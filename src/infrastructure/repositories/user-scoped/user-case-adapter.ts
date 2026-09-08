import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok } from "../../../shared/result/result";
import type { UserCaseId, UserId } from "../../../domain/identifiers/identifiers";
import type { UserCaseFacts } from "../../../domain/case/user-case-facts";
import type { PortError, UserCaseRepositoryPort } from "../../../application/ports/ports";

/**
 * User cases, through the request-scoped client.
 *
 * Every statement runs as the requesting user, so row level security - not this
 * code - is what guarantees a user cannot reach another user's case. The owner
 * filter below is defence in depth, not the control.
 */
export function createUserCaseAdapter(client: SupabaseClient): UserCaseRepositoryPort {
  return {
    async findOwnedById(userCaseId: UserCaseId, ownerUserId: UserId) {
      const result = await client
        .schema("app")
        .from("user_cases")
        .select("id, owner_user_id, facts_jsonb")
        .eq("id", userCaseId as string)
        .eq("owner_user_id", ownerUserId as string)
        .maybeSingle();

      if (result.error !== null) {
        return err<PortError>({ kind: "PORT_ERROR", code: "UNAVAILABLE", detail: result.error.message });
      }
      if (result.data === null) {
        return err<PortError>({ kind: "PORT_ERROR", code: "NOT_FOUND", detail: "user case not found" });
      }
      const row = result.data as { id: string; owner_user_id: string; facts_jsonb: unknown };
      return ok({
        userCaseId: row.id as UserCaseId,
        ownerUserId: row.owner_user_id as UserId,
        facts: row.facts_jsonb as UserCaseFacts,
      });
    },

    async save(ownerUserId: UserId, facts: UserCaseFacts, userCaseId: UserCaseId | null) {
      if (userCaseId === null) {
        const inserted = await client
          .schema("app")
          .from("user_cases")
          .insert({
            owner_user_id: ownerUserId as string,
            facts_schema_version: facts.factsSchemaVersion as string,
            facts_jsonb: facts,
          })
          .select("id")
          .single();
        if (inserted.error !== null) {
          return err<PortError>({ kind: "PORT_ERROR", code: "UNAVAILABLE", detail: inserted.error.message });
        }
        return ok((inserted.data as { id: string }).id as UserCaseId);
      }

      // owner_user_id is deliberately absent from the update: ownership is
      // immutable and a database trigger enforces it.
      const updated = await client
        .schema("app")
        .from("user_cases")
        .update({ facts_schema_version: facts.factsSchemaVersion as string, facts_jsonb: facts })
        .eq("id", userCaseId as string)
        .select("id")
        .maybeSingle();
      if (updated.error !== null) {
        return err<PortError>({ kind: "PORT_ERROR", code: "UNAVAILABLE", detail: updated.error.message });
      }
      if (updated.data === null) {
        return err<PortError>({ kind: "PORT_ERROR", code: "NOT_AUTHORIZED", detail: "case not writable" });
      }
      return ok(userCaseId);
    },

    async erase(userCaseId: UserCaseId) {
      const result = await client.schema("app").rpc("erase_user_case", {
        p_user_case_id: userCaseId as string,
      });
      if (result.error !== null) {
        return err<PortError>({
          kind: "PORT_ERROR",
          code: result.error.message.includes("not authorized") ? "NOT_AUTHORIZED" : "UNAVAILABLE",
          detail: result.error.message,
        });
      }
      return ok(undefined);
    },
  };
}
