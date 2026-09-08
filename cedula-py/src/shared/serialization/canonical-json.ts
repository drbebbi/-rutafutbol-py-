/**
 * Canonical JSON serialization.
 *
 * Requirements (Decision: reproducibility):
 *  - object key order must not influence the output;
 *  - the output must be byte-stable across runs and platforms;
 *  - `undefined` must be rejected rather than silently dropped, because a
 *    silently dropped field would change a content hash without any visible
 *    cause;
 *  - non-finite numbers must be rejected (they are not representable in JSON).
 *
 * Array order is *not* normalised here: arrays are ordered data. Callers that
 * need order-independence sort with an explicit canonical comparator before
 * serializing (see `case-engine/canonicalization`).
 */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export class CanonicalJsonError extends Error {
  public readonly path: string;

  public constructor(message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

function serialize(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }
  const valueType = typeof value;
  if (valueType === "boolean") {
    return value === true ? "true" : "false";
  }
  if (valueType === "number") {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) {
      throw new CanonicalJsonError("non-finite number is not canonicalizable", path);
    }
    if (Object.is(numeric, -0)) {
      return "0";
    }
    return JSON.stringify(numeric);
  }
  if (valueType === "string") {
    return JSON.stringify(value as string);
  }
  if (valueType === "undefined") {
    throw new CanonicalJsonError("undefined is not canonicalizable", path);
  }
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new CanonicalJsonError(`${valueType} is not canonicalizable`, path);
  }
  if (Array.isArray(value)) {
    const parts = value.map((entry, index) => serialize(entry, `${path}[${index}]`));
    return `[${parts.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const entry = record[key];
    if (entry === undefined) {
      throw new CanonicalJsonError(`undefined property "${key}" is not canonicalizable`, path);
    }
    parts.push(`${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/** Deterministic JSON string with lexically sorted object keys. */
export function canonicalJsonStringify(value: unknown): string {
  return serialize(value, "$");
}
