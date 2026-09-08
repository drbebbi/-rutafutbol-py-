/**
 * Route-aware security headers.
 *
 * Three route classes with genuinely different risk:
 *   PUBLIC_STATIC  - marketing and information pages, cacheable.
 *   PRIVATE_DYNAMIC- anything that can see a user's case. Never shared cache.
 *   ADMIN          - the knowledge-base back office. Tightest policy.
 */
export type RouteClass = "PUBLIC_STATIC" | "PRIVATE_DYNAMIC" | "ADMIN";

export type HttpHeader = Readonly<{ key: string; value: string }>;

const BASE_CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  // No plugins, no base tag hijacking, no framing, no cross-origin form posts.
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "upgrade-insecure-requests",
];

/**
 * Builds the Content-Security-Policy for a route class.
 *
 * `unsafe-eval` is never emitted for production. In development Next.js needs
 * it for React Refresh, and only there.
 */
export function contentSecurityPolicy(
  routeClass: RouteClass,
  options: Readonly<{ nonce?: string; isProduction: boolean }>,
): string {
  const scriptSources = ["'self'"];
  if (options.nonce !== undefined) {
    scriptSources.push(`'nonce-${options.nonce}'`, "'strict-dynamic'");
  }
  if (!options.isProduction) {
    scriptSources.push("'unsafe-eval'");
  }

  const styleSources = ["'self'", "'unsafe-inline'"];
  const directives = [
    ...BASE_CSP_DIRECTIVES,
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
  ];

  if (routeClass === "ADMIN") {
    // The admin surface loads nothing from anywhere else, ever.
    directives.push("frame-src 'none'", "media-src 'none'");
  }

  return directives.join("; ");
}

/**
 * Headers that do not depend on the request.
 *
 * Content-Security-Policy is deliberately NOT among them: it carries a
 * per-request nonce and is therefore set by the proxy. Emitting a second,
 * static CSP here would mean two policies are enforced at once, and the
 * intersection would silently block the framework's own bootstrap script -
 * which is exactly the bug this comment exists to prevent recurring.
 */
export function securityHeadersForRouteClass(routeClass: RouteClass): readonly HttpHeader[] {
  const isProduction = process.env.NODE_ENV === "production";
  const headers: HttpHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // The product uses none of these; leaving them enabled is free risk.
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
  ];

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  if (routeClass !== "PUBLIC_STATIC") {
    // Private and admin responses must never end up in a shared cache: one
    // user's case must not be served to the next visitor from an edge node.
    headers.push({ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" });
    headers.push({ key: "Vary", value: "Cookie, Authorization" });
  }

  return headers;
}
