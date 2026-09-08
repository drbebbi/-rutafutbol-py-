import "server-only";
import { err, ok } from "../../../shared/result/result";
import { openInternalConnection } from "../../database/connection";
import type { Sha256Hex } from "../../../domain/primitives/hash";
import type { SchemaVersion } from "../../../domain/primitives/versioning";
import type { EvaluationBundleId } from "../../../domain/identifiers/identifiers";
import type { EvaluationBundleContent } from "../../../rules/bundle/bundle-content";
import type { EvaluationBundleStorePort, PortError } from "../../../application/ports/ports";

/**
 * Materialises evaluation bundles.
 *
 * Delegates to `audit.materialize_evaluation_bundle`, which owns the
 * "same content -> same row, different content under the same hash -> invariant
 * failure" rule. Putting that logic in the database keeps it true no matter
 * which server path stores a bundle.
 */
export function createBundleStoreAdapter(connectionString: string): EvaluationBundleStorePort {
  return {
    async materialize(contentHash: Sha256Hex, schemaVersion: SchemaVersion, content: EvaluationBundleContent) {
      const sql = openInternalConnection(connectionString);
      try {
        const rows = await sql<{ id: string }[]>`
          select audit.materialize_evaluation_bundle(
            ${contentHash as string},
            ${schemaVersion as string},
            ${JSON.stringify(content)}::jsonb
          ) as id`;
        const id = rows[0]?.id;
        if (id === undefined) {
          return err<PortError>({
            kind: "PORT_ERROR",
            code: "INVARIANT_VIOLATION",
            detail: "bundle materialisation returned no id",
          });
        }
        return ok(id as EvaluationBundleId);
      } catch (error) {
        const detail = String(error);
        return err<PortError>({
          kind: "PORT_ERROR",
          code: detail.includes("INVARIANT FAILURE") ? "INVARIANT_VIOLATION" : "UNAVAILABLE",
          detail,
        });
      } finally {
        await sql.end().catch(() => undefined);
      }
    },
  };
}
