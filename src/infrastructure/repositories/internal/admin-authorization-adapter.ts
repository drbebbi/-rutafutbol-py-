import "server-only";
import { err, ok } from "../../../shared/result/result";
import type { UserId } from "../../../domain/identifiers/identifiers";
import type { AdminRole } from "../../../auth/roles/admin-role";
import { ADMIN_ROLES } from "../../../auth/roles/admin-role";
import type { AdminAuthorizationRepositoryPort, PortError } from "../../../application/ports/ports";
import { openInternalConnection } from "../../database/connection";

/**
 * Administrative authority, read on the internal path.
 *
 * Deliberately not a request-scoped Data API client. Such a client carries the
 * requester's own privileges, so asking it whether the requester is an
 * administrator is asking the wrong party - and it would need the browser role
 * to reach `security`, which is exactly the reachability the schema is
 * designed to deny.
 *
 * The lookup is also fresh on every call rather than read from the token. A
 * revoked administrator must lose authority the moment the revocation lands,
 * not when their JWT happens to expire.
 */
export function createAdminAuthorizationAdapter(
  connectionString: string,
): AdminAuthorizationRepositoryPort {
  return {
    async findActiveRolesForUser(userId: UserId) {
      const sql = openInternalConnection(connectionString);
      try {
        // Only the role column, only for this user, only unrevoked rows: the
        // reader needs nothing else, so it asks for nothing else.
        const rows = await sql<{ admin_role: string }[]>`
          select admin_role
          from security.admin_authorizations
          where user_id = ${userId as string}::uuid and revoked_at is null
          order by admin_role`;
        const roles = rows
          .map((row) => row.admin_role)
          .filter((role): role is AdminRole => (ADMIN_ROLES as readonly string[]).includes(role));
        return ok<readonly AdminRole[]>(roles);
      } catch (error) {
        // A failure to read authority is a failure, never an empty list: the
        // caller has to be able to tell "holds no role" from "could not ask".
        return err<PortError>({
          kind: "PORT_ERROR",
          code: "UNAVAILABLE",
          detail: String(error),
        });
      } finally {
        await sql.end().catch(() => undefined);
      }
    },
  };
}
