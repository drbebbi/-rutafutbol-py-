import type { NextConfig } from "next";
import { securityHeadersForRouteClass } from "./src/infrastructure/environment/security-headers";

/**
 * Route-aware security headers (Phase 3H).
 *
 * Next.js `headers()` is static configuration, so the route classes are expressed
 * as path matchers here. Anything more dynamic (nonce-based CSP) is applied in
 * `src/middleware.ts`, which owns the per-request nonce.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Do not generate agent instruction files into the repository.
  agentRules: false,
  headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeadersForRouteClass("PUBLIC_STATIC")],
      },
      {
        source: "/case/:path*",
        headers: [...securityHeadersForRouteClass("PRIVATE_DYNAMIC")],
      },
      {
        source: "/admin/:path*",
        headers: [...securityHeadersForRouteClass("ADMIN")],
      },
      {
        source: "/api/:path*",
        headers: [...securityHeadersForRouteClass("PRIVATE_DYNAMIC")],
      },
    ];
  },
};

export default nextConfig;
