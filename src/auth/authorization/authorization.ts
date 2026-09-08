import { err, ok, type Result } from "../../shared/result/result";
import type { UserId } from "../../domain/identifiers/identifiers";
import {
  requiresAal2,
  requiresSessionLiveness,
  rolesAllowedFor,
  type AdminRole,
  type PrivilegedAction,
} from "../roles/admin-role";

/**
 * The authoritative security identity of a request.
 *
 * Built from verified claims (`getClaims()`), never from a client-supplied
 * body, never from `getSession().user` alone - that reads a cookie the browser
 * controls without verifying it server-side.
 */
export type AuthenticatedIdentity = Readonly<{
  userId: UserId;
  /** Assurance level from the verified claims. */
  assuranceLevel: "aal1" | "aal2";
  /** Roles read from security.admin_authorizations, not from user metadata. */
  adminRoles: readonly AdminRole[];
  /** The instant the claims expire, for liveness checks. */
  expiresAt: number;
}>;

/** Evidence that the provider session is still alive right now. */
export type SessionLiveness = Readonly<{
  providerSessionActive: boolean;
  authorizationCheckedAt: number;
}>;

export type AuthorizationDenial = Readonly<{
  kind: "AUTHORIZATION_DENIED";
  reason:
    | "NOT_AUTHENTICATED"
    | "MISSING_ADMIN_ROLE"
    | "AAL2_REQUIRED"
    | "SESSION_NOT_LIVE"
    | "AUTHORIZATION_STALE";
}>;

export const AUTHORIZATION_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Decides whether a privileged action may proceed.
 *
 * A still-valid JWT is deliberately not sufficient. An administrator whose
 * authority was revoked one minute ago holds a token that remains
 * cryptographically valid until it expires; the liveness and freshness checks
 * are what close that window.
 */
export function authorizePrivilegedAction(
  identity: AuthenticatedIdentity | null,
  action: PrivilegedAction,
  liveness: SessionLiveness | null,
  now: number,
): Result<AuthenticatedIdentity, AuthorizationDenial> {
  if (identity === null) {
    return err({ kind: "AUTHORIZATION_DENIED", reason: "NOT_AUTHENTICATED" });
  }
  const allowed = rolesAllowedFor(action);
  if (!identity.adminRoles.some((role) => allowed.includes(role))) {
    return err({ kind: "AUTHORIZATION_DENIED", reason: "MISSING_ADMIN_ROLE" });
  }
  if (requiresAal2(action) && identity.assuranceLevel !== "aal2") {
    return err({ kind: "AUTHORIZATION_DENIED", reason: "AAL2_REQUIRED" });
  }
  if (requiresSessionLiveness(action)) {
    if (liveness === null || !liveness.providerSessionActive) {
      return err({ kind: "AUTHORIZATION_DENIED", reason: "SESSION_NOT_LIVE" });
    }
    if (now - liveness.authorizationCheckedAt > AUTHORIZATION_FRESHNESS_MS) {
      return err({ kind: "AUTHORIZATION_DENIED", reason: "AUTHORIZATION_STALE" });
    }
  }
  return ok(identity);
}

/**
 * No self escalation: nobody may grant themselves a role, and only an ADMIN may
 * change anybody's roles at all.
 */
export function authorizeRoleChange(
  actor: AuthenticatedIdentity | null,
  subjectUserId: UserId,
  liveness: SessionLiveness | null,
  now: number,
): Result<AuthenticatedIdentity, AuthorizationDenial> {
  const authorized = authorizePrivilegedAction(actor, "CHANGE_ADMIN_ROLE", liveness, now);
  if (!authorized.ok) {
    return authorized;
  }
  if ((authorized.value.userId as string) === (subjectUserId as string)) {
    return err({ kind: "AUTHORIZATION_DENIED", reason: "MISSING_ADMIN_ROLE" });
  }
  return authorized;
}
