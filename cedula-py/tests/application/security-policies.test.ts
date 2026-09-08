import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "../../src/auth/policies/redirect";
import { assertReadOnlyMethod, checkSameOriginRequest } from "../../src/auth/policies/csrf";
import { LOG_FIELD_ALLOWLIST, NEVER_LOG_KEYS, REDACTED, redactForLog } from "../../src/infrastructure/logging/redaction";
import { createLogger, toClientSafeError } from "../../src/infrastructure/logging/logger";
import {
  isSecretEnvironmentVariable,
  parseRedirectAllowlist,
  readPublicEnvironment,
  readServerEnvironment,
  SECRET_ENVIRONMENT_VARIABLES,
} from "../../src/infrastructure/environment/env";
import {
  contentSecurityPolicy,
  securityHeadersForRouteClass,
} from "../../src/infrastructure/environment/security-headers";
import { DATA_CLASSIFICATION_REGISTRY, isHighRisk } from "../../src/application/security/data-classification";
import { RATE_LIMIT_CATEGORIES, policyFor } from "../../src/application/security/rate-limit";
import { retentionFor } from "../../src/application/security/retention";

const ALLOWLIST = ["https://cedula.example", "not a url"];

describe("redirect safety", () => {
  it("accepts a relative path", () => {
    expect(safeRedirectTarget("/case", ALLOWLIST, "/")).toEqual({ target: "/case", rejectedReason: null });
  });

  it("accepts an allowlisted absolute origin", () => {
    const decision = safeRedirectTarget("https://cedula.example/case", ALLOWLIST, "/");
    expect(decision.rejectedReason).toBeNull();
    expect(decision.target).toBe("https://cedula.example/case");
  });

  it("rejects an external origin", () => {
    expect(safeRedirectTarget("https://evil.example/steal", ALLOWLIST, "/")).toEqual({
      target: "/",
      rejectedReason: "NOT_ALLOWLISTED",
    });
  });

  it("rejects a protocol-relative URL that a browser would treat as absolute", () => {
    expect(safeRedirectTarget("//evil.example", ALLOWLIST, "/").rejectedReason).toBe("PROTOCOL_RELATIVE");
  });

  it("rejects a backslash trick", () => {
    expect(safeRedirectTarget("/\\evil.example", ALLOWLIST, "/").rejectedReason).toBe("BACKSLASH_TRICK");
  });

  it("rejects a non-http scheme and unparseable input", () => {
    // `javascript:` parses as a URL, so it is caught by the protocol check
    // rather than the allowlist - refused either way, and never executed.
    expect(safeRedirectTarget("javascript:alert(1)", ALLOWLIST, "/").rejectedReason).toBe("MALFORMED");
    expect(safeRedirectTarget("ht tp://x", ALLOWLIST, "/").rejectedReason).toBe("MALFORMED");
    expect(safeRedirectTarget("javascript:alert(1)", ALLOWLIST, "/").target).toBe("/");
  });

  it("falls back for an empty or absent target", () => {
    expect(safeRedirectTarget(null, ALLOWLIST, "/").target).toBe("/");
    expect(safeRedirectTarget("", ALLOWLIST, "/").target).toBe("/");
    expect(safeRedirectTarget(undefined, ALLOWLIST, "/").target).toBe("/");
  });

  it("parses the allowlist from configuration", () => {
    expect(parseRedirectAllowlist("https://a.example, https://b.example ,")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("CSRF controls", () => {
  it("allows a same-origin state change", () => {
    expect(
      checkSameOriginRequest("POST", "https://cedula.example", "cedula.example", "https://cedula.example"),
    ).toEqual({ allowed: true, reason: "OK" });
  });

  it("refuses a cross-origin state change", () => {
    expect(checkSameOriginRequest("POST", "https://evil.example", "cedula.example", "https://cedula.example").allowed).toBe(false);
  });

  it("refuses a state change with no Origin at all", () => {
    expect(checkSameOriginRequest("POST", null, "cedula.example", null).reason).toBe("MISSING_ORIGIN");
  });

  it("falls back to the Host header when no expected origin is configured", () => {
    expect(checkSameOriginRequest("POST", "https://cedula.example", "cedula.example", null).allowed).toBe(true);
    expect(checkSameOriginRequest("POST", "https://cedula.example", "other.example", null).allowed).toBe(false);
  });

  it("refuses a malformed Origin", () => {
    expect(checkSameOriginRequest("POST", "not-a-url", "cedula.example", null).allowed).toBe(false);
    expect(checkSameOriginRequest("POST", "https://cedula.example", "cedula.example", "not-a-url").allowed).toBe(false);
  });

  it("lets reads through and marks them read-only", () => {
    expect(checkSameOriginRequest("GET", null, null, null).allowed).toBe(true);
    expect(assertReadOnlyMethod("GET")).toBe(true);
    expect(assertReadOnlyMethod("HEAD")).toBe(true);
    expect(assertReadOnlyMethod("POST")).toBe(false);
  });
});

describe("logging", () => {
  it("keeps allowlisted scalars and redacts everything else", () => {
    const record = redactForLog({
      event: "evaluate_completed",
      caseType: "STANDARD_FIRST_CEDULA_FROM_NONE",
      blockingIssueCount: 2,
      facts: { residenceHistory: [{ countryCode: "PY" }] },
      residenceHistory: ["PY"],
      somethingNew: "value",
    });
    expect(record["event"]).toBe("evaluate_completed");
    expect(record["caseType"]).toBe("STANDARD_FIRST_CEDULA_FROM_NONE");
    expect(record["blockingIssueCount"]).toBe(2);
    expect(record["facts"]).toBe(REDACTED);
    expect(record["residenceHistory"]).toBe(REDACTED);
    // Allowlist, not blocklist: an unknown key is redacted by default.
    expect(record["somethingNew"]).toBe(REDACTED);
  });

  it("redacts an allowlisted key that carries a non-scalar payload", () => {
    expect(redactForLog({ caseType: { nested: "case" } })["caseType"]).toBe(REDACTED);
  });

  it("never allowlists a key that must never be logged", () => {
    for (const key of NEVER_LOG_KEYS) {
      expect(LOG_FIELD_ALLOWLIST, key).not.toContain(key);
    }
  });

  it("routes every level through redaction", () => {
    const written: { level: string; record: Record<string, unknown> }[] = [];
    const logger = createLogger((level, record) => written.push({ level, record: { ...record } }));
    logger.debug({ facts: "secret" });
    logger.info({ facts: "secret" });
    logger.warn({ facts: "secret" });
    logger.error({ facts: "secret" });
    expect(written).toHaveLength(4);
    for (const entry of written) {
      expect(entry.record["facts"]).toBe(REDACTED);
    }
  });

  it("gives the browser a code and a correlation id, never an internal message", () => {
    const safe = toClientSafeError("EVALUATION_FAILED", "abc-123");
    expect(safe.code).toBe("EVALUATION_FAILED");
    expect(safe.correlationId).toBe("abc-123");
    expect(safe.message).not.toMatch(/stack|sql|postgres/iu);
  });
});

describe("environment", () => {
  it("validates the public environment", () => {
    expect(
      readPublicEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(30),
        NEXT_PUBLIC_SITE_URL: "https://cedula.example",
      }).ok,
    ).toBe(true);
  });

  it("reports variable names only, never values", () => {
    const result = readServerEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "too-short" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.missingOrInvalid).toEqual([
      "CEDULA_AUTH_REDIRECT_ALLOWLIST",
      "CEDULA_ENVIRONMENT",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    expect(JSON.stringify(result.error)).not.toContain("too-short");
  });

  it("knows which variables are secret", () => {
    expect(isSecretEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY")).toBe(true);
    expect(isSecretEnvironmentVariable("NEXT_PUBLIC_SITE_URL")).toBe(false);
    for (const name of SECRET_ENVIRONMENT_VARIABLES) {
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });
});

describe("security headers", () => {
  it("meets the minimum policy targets", () => {
    const csp = contentSecurityPolicy("PUBLIC_STATIC", { isProduction: true });
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("never emits unsafe-eval in production", () => {
    expect(contentSecurityPolicy("PUBLIC_STATIC", { isProduction: true })).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy("PUBLIC_STATIC", { isProduction: false })).toContain("unsafe-eval");
  });

  it("carries a nonce when one is supplied", () => {
    const csp = contentSecurityPolicy("PRIVATE_DYNAMIC", { nonce: "abc", isProduction: true });
    expect(csp).toContain("'nonce-abc'");
    expect(csp).toContain("'strict-dynamic'");
  });

  it("tightens the admin surface further", () => {
    expect(contentSecurityPolicy("ADMIN", { isProduction: true })).toContain("frame-src 'none'");
  });

  it("does not emit a static CSP, because the proxy owns the nonce policy", () => {
    const keys = securityHeadersForRouteClass("PUBLIC_STATIC").map((header) => header.key);
    expect(keys).not.toContain("Content-Security-Policy");
    expect(keys).toContain("X-Content-Type-Options");
    expect(keys).toContain("Referrer-Policy");
    expect(keys).toContain("Permissions-Policy");
  });

  it("keeps private and admin responses out of shared caches", () => {
    for (const routeClass of ["PRIVATE_DYNAMIC", "ADMIN"] as const) {
      const headers = securityHeadersForRouteClass(routeClass);
      const cacheControl = headers.find((header) => header.key === "Cache-Control");
      expect(cacheControl?.value, routeClass).toContain("no-store");
    }
    expect(
      securityHeadersForRouteClass("PUBLIC_STATIC").some((header) => header.key === "Cache-Control"),
    ).toBe(false);
  });

  it("restricts unused device permissions", () => {
    const policy = securityHeadersForRouteClass("PUBLIC_STATIC").find(
      (header) => header.key === "Permissions-Policy",
    );
    expect(policy?.value).toContain("camera=()");
    expect(policy?.value).toContain("microphone=()");
    expect(policy?.value).toContain("geolocation=()");
  });
});

describe("security registries", () => {
  it("classifies the evaluation input snapshot as personal high risk", () => {
    expect(isHighRisk("app.case_evaluations.input_snapshot_jsonb")).toBe(true);
    expect(isHighRisk("app.user_cases.facts_jsonb")).toBe(true);
    expect(isHighRisk("core.*")).toBe(false);
  });

  it("classifies the service role key as secret", () => {
    const entry = DATA_CLASSIFICATION_REGISTRY.find((item) => item.asset === "SUPABASE_SERVICE_ROLE_KEY");
    expect(entry?.classification).toBe("SECRET");
  });

  it("defines a policy for every rate limit category", () => {
    for (const category of RATE_LIMIT_CATEGORIES) {
      expect(policyFor(category).maxRequests, category).toBeGreaterThan(0);
    }
  });

  it("does not expire the knowledge publication audit on a fixed clock", () => {
    expect(retentionFor("KNOWLEDGE_PUBLICATION_AUDIT").retentionDays).toBeNull();
    expect(retentionFor("OPERATIONAL_LOG").retentionDays).toBe(30);
    expect(retentionFor("SECURITY_ABUSE_LOG").retentionDays).toBe(90);
    expect(retentionFor("SECURITY_AUTHORIZATION_AUDIT").retentionDays).toBe(365);
  });
});
