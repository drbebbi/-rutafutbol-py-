import { describe, expect, it } from "vitest";
import { authorizePrivilegedAction } from "../../src/auth/authorization/authorization";
import type { AuthenticatedIdentity } from "../../src/auth/authorization/authorization";
import type { AdminAuthorizationRepositoryPort } from "../../src/application/ports/ports";
import type { AdminRole } from "../../src/auth/roles/admin-role";
import type { UserId } from "../../src/domain/identifiers/identifiers";
import { err, ok } from "../../src/shared/result/result";

/**
 * Administrative authority is a fresh lookup, not a token claim.
 *
 * The identity resolver itself lives in infrastructure and needs a Supabase
 * client, so what is exercised here is the contract it depends on: a
 * repository that answers with the roles held *now*, and a caller that treats
 * "could not ask" as a denial rather than as "holds no role".
 */
const USER = "00000000-0000-4000-8000-0000000000e1" as UserId;

function repositoryReturning(roles: readonly AdminRole[]): AdminAuthorizationRepositoryPort {
  return { findActiveRolesForUser: () => Promise.resolve(ok(roles)) };
}

const unavailable: AdminAuthorizationRepositoryPort = {
  findActiveRolesForUser: () =>
    Promise.resolve(err({ kind: "PORT_ERROR", code: "UNAVAILABLE", detail: "down" })),
};

/** What the identity resolver does with a repository answer, in miniature. */
async function identityFrom(
  repository: AdminAuthorizationRepositoryPort,
  assuranceLevel: "aal1" | "aal2",
): Promise<AuthenticatedIdentity | null> {
  const roles = await repository.findActiveRolesForUser(USER);
  if (!roles.ok) {
    return null;
  }
  return {
    userId: USER,
    assuranceLevel,
    adminRoles: roles.value,
    expiresAt: Date.now() + 60_000,
  };
}

const live = { providerSessionActive: true, authorizationCheckedAt: Date.now() };

describe("administrative authorization", () => {
  it("allows a publisher at AAL2 with a live session", async () => {
    const identity = await identityFrom(repositoryReturning(["PUBLISHER"]), "aal2");
    const decision = authorizePrivilegedAction(identity, "PUBLISH_RULE", live, Date.now());
    expect(decision.ok).toBe(true);
  });

  it("denies once the role is revoked, even though the token still says otherwise", async () => {
    // The JWT is unchanged; only the authorization table moved on. The lookup
    // is fresh on every call precisely so that this is the outcome.
    const identity = await identityFrom(repositoryReturning([]), "aal2");
    const decision = authorizePrivilegedAction(identity, "PUBLISH_RULE", live, Date.now());
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.error.reason).toBe("MISSING_ADMIN_ROLE");
  });

  it("fails closed when authority cannot be read at all", async () => {
    const identity = await identityFrom(unavailable, "aal2");
    // Not "signed in with no roles": no identity at all. The difference is
    // what stops a read-only admin page rendering as though the check ran.
    expect(identity).toBeNull();
    const decision = authorizePrivilegedAction(identity, "PUBLISH_RULE", live, Date.now());
    expect(decision.ok).toBe(false);
  });

  it("denies a publisher who has not completed a second factor", async () => {
    const identity = await identityFrom(repositoryReturning(["PUBLISHER"]), "aal1");
    const decision = authorizePrivilegedAction(identity, "PUBLISH_RULE", live, Date.now());
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.error.reason).toBe("AAL2_REQUIRED");
  });
});
