import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserId } from "../../../domain/identifiers/identifiers";
import type { AuthenticatedIdentity, SessionLiveness } from "../../../auth/authorization/authorization";
import type { AdminAuthorizationRepositoryPort } from "../../../application/ports/ports";

/**
 * Resolves the authoritative server identity.
 *
 * Uses `getClaims()`, which verifies the token, and falls back to `getUser()`,
 * which asks the auth server. `getSession()` is deliberately not used as the
 * security identity: it returns whatever is in the cookie without verifying it.
 */
export async function resolveAuthenticatedIdentity(
  client: SupabaseClient,
  adminAuthorizations: AdminAuthorizationRepositoryPort,
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

  /*
   * Authority is looked up fresh, on the internal path, every time.
   *
   * Not from the token: a JWT minted before a revocation would still carry the
   * role. Not through the request-scoped client either: that client holds the
   * requester's own privileges, and the browser roles cannot reach `security`
   * at all - by design.
   *
   * A lookup that fails yields no identity rather than an identity with no
   * roles. The difference matters: the second reads as "signed in, not an
   * administrator", which would let a read-only page render as if the check
   * had succeeded.
   */
  const roles = await adminAuthorizations.findActiveRolesForUser(userId as UserId);
  if (!roles.ok) {
    return null;
  }

  return {
    userId: userId as UserId,
    assuranceLevel,
    adminRoles: roles.value,
    expiresAt,
  };
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
