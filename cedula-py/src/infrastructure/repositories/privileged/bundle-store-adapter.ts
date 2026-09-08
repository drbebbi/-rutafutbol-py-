import "server-only";
import pg from "pg";
import { err, ok } from "../../../shared/result/result";
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
      const client = new pg.Client({ connectionString });
      try {
        await client.connect();
        const result = await client.query<{ id: string }>(
          "select audit.materialize_evaluation_bundle($1, $2, $3::jsonb) as id",
          [contentHash as string, schemaVersion as string, JSON.stringify(content)],
        );
        const id = result.rows[0]?.id;
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
        await client.end().catch(() => undefined);
      }
    },
  };
}
