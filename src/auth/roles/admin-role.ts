/**
 * Administrative roles.
 *
 * The authoritative record lives in `security.admin_authorizations`. It is
 * never read from `user_metadata`, which the user can write to themselves;
 * `app_metadata` may at most drive a UX hint, never an authorization decision.
 */
export type AdminRole = "RESEARCHER" | "PUBLISHER" | "ADMIN";

export const ADMIN_ROLES: readonly AdminRole[] = ["RESEARCHER", "PUBLISHER", "ADMIN"];

export type PrivilegedAction =
  | "PUBLISH_RULE"
  | "EDIT_RESEARCH"
  | "CHANGE_ADMIN_ROLE"
  | "REVOKE_ADMIN"
  | "SECURITY_CONFIG_CHANGE"
  | "READ_ADMIN_AUDIT";

/** Which roles may perform which privileged action. */
export function rolesAllowedFor(action: PrivilegedAction): readonly AdminRole[] {
  switch (action) {
    case "EDIT_RESEARCH":
      return ["RESEARCHER", "PUBLISHER", "ADMIN"];
    case "PUBLISH_RULE":
      return ["PUBLISHER", "ADMIN"];
    case "CHANGE_ADMIN_ROLE":
    case "REVOKE_ADMIN":
    case "SECURITY_CONFIG_CHANGE":
    case "READ_ADMIN_AUDIT":
      return ["ADMIN"];
  }
}

/**
 * Actions that need more than a valid token: a live provider session and a
 * second factor at the time of the action.
 */
export function requiresSessionLiveness(action: PrivilegedAction): boolean {
  return (
    action === "PUBLISH_RULE" ||
    action === "CHANGE_ADMIN_ROLE" ||
    action === "REVOKE_ADMIN" ||
    action === "SECURITY_CONFIG_CHANGE"
  );
}

export function requiresAal2(_action: PrivilegedAction): boolean {
  // Every privileged action requires AAL2. The parameter is kept so the call
  // sites read the same as the liveness check and so the policy can become
  // per-action without a signature change.
  return true;
}
