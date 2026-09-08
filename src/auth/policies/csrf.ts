/**
 * Cross-site request forgery controls for custom route handlers.
 *
 * Next.js protects Server Actions with its own origin check. A custom
 * cookie-authenticated route handler gets none of that, so it does its own:
 * the request must be same-origin, and GET/HEAD may never mutate state.
 */
export type CsrfDecision = Readonly<{
  allowed: boolean;
  reason: "OK" | "MISSING_ORIGIN" | "CROSS_ORIGIN" | "UNSAFE_METHOD_FOR_READ";
}>;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function checkSameOriginRequest(
  method: string,
  originHeader: string | null,
  hostHeader: string | null,
  expectedOrigin: string | null,
): CsrfDecision {
  const upper = method.toUpperCase();

  if (!STATE_CHANGING_METHODS.has(upper)) {
    // A read is allowed, and by construction it must not mutate anything.
    return { allowed: true, reason: "OK" };
  }

  if (originHeader === null || originHeader === "") {
    // A state-changing request from a browser always carries Origin. Its
    // absence is treated as hostile rather than as "probably a server call".
    return { allowed: false, reason: "MISSING_ORIGIN" };
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return { allowed: false, reason: "CROSS_ORIGIN" };
  }

  if (expectedOrigin !== null) {
    try {
      if (origin.origin !== new URL(expectedOrigin).origin) {
        return { allowed: false, reason: "CROSS_ORIGIN" };
      }
      return { allowed: true, reason: "OK" };
    } catch {
      return { allowed: false, reason: "CROSS_ORIGIN" };
    }
  }

  if (hostHeader === null || origin.host !== hostHeader) {
    return { allowed: false, reason: "CROSS_ORIGIN" };
  }
  return { allowed: true, reason: "OK" };
}

/** A GET/HEAD handler that mutates state is a bug this makes explicit. */
export function assertReadOnlyMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD";
}
