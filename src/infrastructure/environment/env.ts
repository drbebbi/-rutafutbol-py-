import { z } from "zod";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Environment validation.
 *
 * Two rules the type system enforces here:
 *   1. Anything not prefixed `NEXT_PUBLIC_` never reaches the browser bundle.
 *   2. Nothing in this module is ever logged. The parsed values are returned to
 *      the caller; the failure path reports variable *names* only.
 */
export type DeploymentEnvironment = "LOCAL" | "PREVIEW" | "PRODUCTION";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CEDULA_ENVIRONMENT: z.enum(["LOCAL", "PREVIEW", "PRODUCTION"]),
  CEDULA_AUTH_REDIRECT_ALLOWLIST: z.string().min(1),
});

export type PublicEnvironment = z.infer<typeof publicSchema>;
export type ServerEnvironment = z.infer<typeof serverSchema>;

export type EnvironmentError = Readonly<{
  kind: "ENVIRONMENT_INVALID";
  /** Variable names only. Never a value, not even a truncated one. */
  missingOrInvalid: readonly string[];
}>;

function namesOf(issues: readonly { path: readonly PropertyKey[] }[]): readonly string[] {
  return [...new Set(issues.map((issue) => String(issue.path[0] ?? "<root>")))].sort();
}

export function readPublicEnvironment(
  source: Record<string, string | undefined>,
): Result<PublicEnvironment, EnvironmentError> {
  const parsed = publicSchema.safeParse(source);
  return parsed.success
    ? ok(parsed.data)
    : err({ kind: "ENVIRONMENT_INVALID", missingOrInvalid: namesOf(parsed.error.issues) });
}

export function readServerEnvironment(
  source: Record<string, string | undefined>,
): Result<ServerEnvironment, EnvironmentError> {
  const parsed = serverSchema.safeParse(source);
  return parsed.success
    ? ok(parsed.data)
    : err({ kind: "ENVIRONMENT_INVALID", missingOrInvalid: namesOf(parsed.error.issues) });
}

/** Variable names that must never appear in a client bundle or a log line. */
export const SECRET_ENVIRONMENT_VARIABLES: readonly string[] = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
];

export function isSecretEnvironmentVariable(name: string): boolean {
  return SECRET_ENVIRONMENT_VARIABLES.includes(name);
}

export function parseRedirectAllowlist(raw: string): readonly string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
