/**
 * Logging by allowlist.
 *
 * A blocklist fails the moment someone adds a field. The allowlist below is the
 * complete set of keys that may appear in an operational log line; everything
 * else is replaced, whatever it is called and however deeply it is nested.
 */
export const LOG_FIELD_ALLOWLIST: readonly string[] = [
  "event",
  "level",
  "correlationId",
  "route",
  "routeClass",
  "method",
  "statusCode",
  "durationMs",
  "outcome",
  "errorCode",
  "engineVersion",
  "evaluationSchemaVersion",
  "bundleContentHash",
  "caseType",
  "classificationStatus",
  "blockingIssueCount",
  "verificationFlagCount",
  "requiredProcedureCount",
  "requiredDocumentCount",
  "ruleId",
  "ruleRevisionId",
  "adminAction",
  "rateLimitCategory",
];

export const REDACTED = "[redacted]";

/**
 * Keys that must never be logged even if someone adds them to the allowlist by
 * mistake. The allowlist is the mechanism; this is the tripwire.
 */
export const NEVER_LOG_KEYS: readonly string[] = [
  "facts",
  "factsJsonb",
  "userCaseFacts",
  "inputSnapshot",
  "inputSnapshotJsonb",
  "residenceHistory",
  "specialCase",
  "specialCaseAnswers",
  "nationalities",
  "maritalStatus",
  "decisionJsonb",
  "token",
  "accessToken",
  "refreshToken",
  "otp",
  "password",
  "mfaSecret",
  "serviceRoleKey",
  "databaseUrl",
  "authorization",
  "cookie",
  "body",
  "requestBody",
];

export type LogRecord = Readonly<Record<string, unknown>>;

/**
 * Projects an arbitrary object onto the allowlist.
 *
 * Values are additionally restricted to scalars: an allowlisted key holding an
 * object could smuggle a whole case through.
 */
export function redactForLog(input: LogRecord): LogRecord {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (NEVER_LOG_KEYS.includes(key)) {
      output[key] = REDACTED;
      continue;
    }
    if (!LOG_FIELD_ALLOWLIST.includes(key)) {
      output[key] = REDACTED;
      continue;
    }
    const type = typeof value;
    if (value === null || type === "string" || type === "number" || type === "boolean") {
      output[key] = value;
      continue;
    }
    output[key] = REDACTED;
  }
  return output;
}
