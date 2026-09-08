import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_FRESHNESS_MS,
  authorizePrivilegedAction,
  authorizeRoleChange,
  type AuthenticatedIdentity,
  type SessionLiveness,
} from "../../src/auth/authorization/authorization";
import { ADMIN_ROLES, requiresAal2, requiresSessionLiveness, rolesAllowedFor } from "../../src/auth/roles/admin-role";
import type { UserId } from "../../src/domain/identifiers/identifiers";

const NOW = 1_800_000_000_000;

function identity(overrides: Partial<AuthenticatedIdentity> = {}): AuthenticatedIdentity {
  return {
    userId: "11111111-1111-4111-8111-111111111111" as UserId,
    assuranceLevel: "aal2",
    adminRoles: ["PUBLISHER"],
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

const live: SessionLiveness = { providerSessionActive: true, authorizationCheckedAt: NOW };

describe("admin roles", () => {
  it("defines the three roles the decision model requires", () => {
    expect(ADMIN_ROLES).toEqual(["RESEARCHER", "PUBLISHER", "ADMIN"]);
  });

  it("restricts publication to publishers and admins", () => {
    expect(rolesAllowedFor("PUBLISH_RULE")).toEqual(["PUBLISHER", "ADMIN"]);
    expect(rolesAllowedFor("CHANGE_ADMIN_ROLE")).toEqual(["ADMIN"]);
    expect(rolesAllowedFor("EDIT_RESEARCH")).toContain("RESEARCHER");
  });

  it("requires AAL2 for every privileged action and liveness for the dangerous ones", () => {
    expect(requiresAal2("EDIT_RESEARCH")).toBe(true);
    expect(requiresSessionLiveness("PUBLISH_RULE")).toBe(true);
    expect(requiresSessionLiveness("CHANGE_ADMIN_ROLE")).toBe(true);
    expect(requiresSessionLiveness("REVOKE_ADMIN")).toBe(true);
    expect(requiresSessionLiveness("SECURITY_CONFIG_CHANGE")).toBe(true);
    expect(requiresSessionLiveness("READ_ADMIN_AUDIT")).toBe(false);
  });
});

describe("privileged action authorization", () => {
  it("allows a live, second-factor publisher to publish", () => {
    expect(authorizePrivilegedAction(identity(), "PUBLISH_RULE", live, NOW).ok).toBe(true);
  });

  it("denies an unauthenticated caller", () => {
    const result = authorizePrivilegedAction(null, "PUBLISH_RULE", live, NOW);
    expect(!result.ok && result.error.reason).toBe("NOT_AUTHENTICATED");
  });

  it("denies a caller without the role", () => {
    const result = authorizePrivilegedAction(identity({ adminRoles: ["RESEARCHER"] }), "PUBLISH_RULE", live, NOW);
    expect(!result.ok && result.error.reason).toBe("MISSING_ADMIN_ROLE");
  });

  it("denies a single-factor session", () => {
    const result = authorizePrivilegedAction(identity({ assuranceLevel: "aal1" }), "PUBLISH_RULE", live, NOW);
    expect(!result.ok && result.error.reason).toBe("AAL2_REQUIRED");
  });

  it("denies a token whose provider session is no longer alive", () => {
    const result = authorizePrivilegedAction(
      identity(),
      "PUBLISH_RULE",
      { providerSessionActive: false, authorizationCheckedAt: NOW },
      NOW,
    );
    expect(!result.ok && result.error.reason).toBe("SESSION_NOT_LIVE");
  });

  it("denies when the authorization check is stale, closing the revocation window", () => {
    // An administrator revoked a minute ago still holds a cryptographically
    // valid token; freshness is what stops it from being enough.
    const result = authorizePrivilegedAction(
      identity(),
      "PUBLISH_RULE",
      { providerSessionActive: true, authorizationCheckedAt: NOW - AUTHORIZATION_FRESHNESS_MS - 1 },
      NOW,
    );
    expect(!result.ok && result.error.reason).toBe("AUTHORIZATION_STALE");
  });

  it("does not require liveness for a read-only admin action", () => {
    expect(authorizePrivilegedAction(identity({ adminRoles: ["ADMIN"] }), "READ_ADMIN_AUDIT", null, NOW).ok).toBe(true);
  });
});

describe("no self escalation", () => {
  it("refuses to let an administrator change their own roles", () => {
    const actor = identity({ adminRoles: ["ADMIN"] });
    const result = authorizeRoleChange(actor, actor.userId, live, NOW);
    expect(!result.ok && result.error.reason).toBe("MISSING_ADMIN_ROLE");
  });

  it("allows an administrator to change somebody else's roles", () => {
    const actor = identity({ adminRoles: ["ADMIN"] });
    const other = "22222222-2222-4222-8222-222222222222" as UserId;
    expect(authorizeRoleChange(actor, other, live, NOW).ok).toBe(true);
  });

  it("refuses a role change from a publisher", () => {
    const result = authorizeRoleChange(
      identity({ adminRoles: ["PUBLISHER"] }),
      "22222222-2222-4222-8222-222222222222" as UserId,
      live,
      NOW,
    );
    expect(!result.ok && result.error.reason).toBe("MISSING_ADMIN_ROLE");
  });
});
