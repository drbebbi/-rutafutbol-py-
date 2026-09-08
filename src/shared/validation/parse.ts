import type { ZodType } from "zod";
import { err, ok, type Result } from "../result/result";

/**
 * Structured, transport-free representation of a schema violation.
 *
 * Zod issues are converted eagerly so that no `zod` type ever escapes into the
 * domain or engine layers.
 */
export type ValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type ValidationFailure = Readonly<{
  kind: "VALIDATION_FAILURE";
  issues: readonly ValidationIssue[];
}>;

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "$";
  }
  return path.reduce<string>((acc, segment) => {
    return typeof segment === "number" ? `${acc}[${segment}]` : `${acc}.${String(segment)}`;
  }, "$");
}

export function parseWithSchema<T>(schema: ZodType<T>, input: unknown): Result<T, ValidationFailure> {
  const result = schema.safeParse(input);
  if (result.success) {
    return ok(result.data);
  }
  const issues = result.error.issues
    .map((issue) => ({
      path: formatPath(issue.path),
      code: issue.code,
      message: issue.message,
    }))
    .sort((a, b) => (a.path === b.path ? a.code.localeCompare(b.code) : a.path.localeCompare(b.path)));
  return err({ kind: "VALIDATION_FAILURE", issues });
}
