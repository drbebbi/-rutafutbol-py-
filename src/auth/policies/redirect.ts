/**
 * Post-authentication redirect safety.
 *
 * `next`, `returnTo` and `redirect` all arrive from the browser and are all
 * attacker-controlled. A relative path is accepted; an absolute URL only if its
 * origin is on the allowlist. Everything else falls back to a fixed default,
 * because a login flow that lands on someone else's domain is a phishing
 * primitive.
 */
export type RedirectDecision = Readonly<{
  target: string;
  rejectedReason: "NOT_ALLOWLISTED" | "PROTOCOL_RELATIVE" | "MALFORMED" | "BACKSLASH_TRICK" | null;
}>;

export function safeRedirectTarget(
  requested: string | null | undefined,
  allowlist: readonly string[],
  fallback: string,
): RedirectDecision {
  if (requested === null || requested === undefined || requested === "") {
    return { target: fallback, rejectedReason: null };
  }

  // "//evil.example" and "/\evil.example" are both browser-resolved as an
  // absolute origin despite starting with a slash.
  if (requested.startsWith("//")) {
    return { target: fallback, rejectedReason: "PROTOCOL_RELATIVE" };
  }
  if (requested.includes("\\")) {
    return { target: fallback, rejectedReason: "BACKSLASH_TRICK" };
  }

  if (requested.startsWith("/")) {
    return { target: requested, rejectedReason: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(requested);
  } catch {
    return { target: fallback, rejectedReason: "MALFORMED" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { target: fallback, rejectedReason: "MALFORMED" };
  }

  const allowedOrigins = new Set<string>();
  for (const entry of allowlist) {
    try {
      allowedOrigins.add(new URL(entry).origin);
    } catch {
      // An unparseable allowlist entry is ignored rather than widening access.
    }
  }
  if (!allowedOrigins.has(parsed.origin)) {
    return { target: fallback, rejectedReason: "NOT_ALLOWLISTED" };
  }
  return { target: parsed.toString(), rejectedReason: null };
}
