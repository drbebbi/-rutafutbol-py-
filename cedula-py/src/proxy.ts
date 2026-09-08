import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  contentSecurityPolicy,
  type RouteClass,
} from "./infrastructure/environment/security-headers";

/**
 * Proxy (the Next.js 16 name for middleware): CSP nonce, session refresh and
 * private-cache hardening.
 *
 * Three jobs:
 *  1. Mint a per-request nonce and emit the Content-Security-Policy that
 *     carries it. The policy is also set on the *request*, because that is how
 *     the framework learns which nonce to stamp on its own bootstrap scripts.
 *     This is why no static CSP is configured in `next.config.ts`: two policies
 *     would both be enforced, and their intersection would block hydration.
 *  2. Refresh the Supabase session cookie, so a Server Component never renders
 *     against an expired token.
 *  3. Keep anything that can see a user's case out of a shared cache.
 */
const PRIVATE_PREFIXES = ["/case", "/api", "/auth"];
const ADMIN_PREFIX = "/admin";

function routeClassFor(pathname: string): RouteClass {
  if (pathname.startsWith(ADMIN_PREFIX)) {
    return "ADMIN";
  }
  return PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    ? "PRIVATE_DYNAMIC"
    : "PUBLIC_STATIC";
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const routeClass = routeClassFor(request.nextUrl.pathname);
  const csp = contentSecurityPolicy(routeClass, {
    nonce,
    isProduction: process.env.NODE_ENV === "production",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (url !== undefined && anonKey !== undefined) {
    const client = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    // getUser() asks the auth server, which is what actually refreshes the
    // session. getSession() would only read the cookie back unverified.
    await client.auth.getUser().catch(() => undefined);
  }

  if (routeClass !== "PUBLIC_STATIC") {
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    response.headers.set("Vary", "Cookie, Authorization");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png).*)"],
};
