import "server-only";
import type { AdminAuthorizationRepositoryPort } from "../../../application/ports/ports";
import { createAdminAuthorizationAdapter } from "../../repositories/internal/admin-authorization-adapter";
import { err } from "../../../shared/result/result";

/**
 * The authorization reader a server render should use.
 *
 * When no internal connection is configured, the reader fails rather than
 * returning no roles: an environment that cannot check authority must deny
 * access, not quietly render as "signed in, not an administrator".
 */
export function adminAuthorizationsFromEnvironment(): AdminAuthorizationRepositoryPort {
  const connectionString = process.env["SUPABASE_DB_URL"];
  if (connectionString === undefined || connectionString === "") {
    return {
      findActiveRolesForUser: () =>
        Promise.resolve(
          err({
            kind: "PORT_ERROR" as const,
            code: "UNAVAILABLE" as const,
            detail: "no internal database connection is configured",
          }),
        ),
    };
  }
  return createAdminAuthorizationAdapter(connectionString);
}
