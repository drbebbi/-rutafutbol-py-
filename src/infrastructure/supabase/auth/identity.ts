import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserId } from "../../../domain/identifiers/identifiers";
import type { AdminRole } from "../../../auth/roles/admin-role";
import type { AuthenticatedIdentity, SessionLiveness } from "../../../auth/authorization/authorization";

/**
 * Resolves the authoritative server identity.
 *
 * Uses `getClaims()`, which verifies the token, and falls back to `getUser()`,
 * which asks the auth server. `getSession()` is deliberately not used as the
 * security identity: it returns whatever is in the cookie without verifying it.
 */
export async function resolveAuthenticatedIdentity(
  client: SupabaseClient,
): Promise<AuthenticatedIdentity | null> {
  const claimsResult = await client.auth.getClaims();
  const claims = claimsResult.data?.claims as
    | Readonly<{ sub?: string; aal?: string; exp?: number }>
    | undefined;

  let userId = claims?.sub;
  let assuranceLevel = claims?.aal === "aal2" ? ("aal2" as const) : ("aal1" as const);
  let expiresAt = typeof claims?.exp === "number" ? claims.exp * 1000 : 0;

  if (userId === undefined) {
    const userResult = await client.auth.getUser();
    const user = userResult.data.user;
    if (user === null) {
      return null;
    }
    userId = user.id;
    assuranceLevel = "aal1";
    expiresAt = 0;
  }

  const adminRoles = await readAdminRoles(client, userId);

  return {
    userId: userId as UserId,
    assuranceLevel,
    adminRoles,
    expiresAt,
  };
}

/**
 * Administrative authority comes from `security.admin_authorizations`.
 * `user_metadata.admin` is user-writable and is never consulted.
 */
async function readAdminRoles(client: SupabaseClient, userId: string): Promise<readonly AdminRole[]> {
  const result = await client
    .schema("security")
    .from("admin_authorizations")
    .select("admin_role")
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (result.error !== null || result.data === null) {
    // A failure to read authority is never read as "has authority".
    return [];
  }
  return result.data
    .map((row) => (row as { admin_role: string }).admin_role as AdminRole)
    .filter((role): role is AdminRole => role === "RESEARCHER" || role === "PUBLISHER" || role === "ADMIN");
}

/**
 * Confirms the provider session is still live at this moment, rather than
 * trusting a token that has not yet expired.
 */
export async function checkSessionLiveness(client: SupabaseClient): Promise<SessionLiveness> {
  const userResult = await client.auth.getUser();
  return {
    providerSessionActive: userResult.data.user !== null && userResult.error === null,
    authorizationCheckedAt: Date.now(),
  };
}
