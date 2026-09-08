import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/** Monotonic revision counter within one stable identity, starting at 1. */
export type RevisionNumber = Brand<number, "RevisionNumber">;

export function makeRevisionNumber(value: number): Result<RevisionNumber, PrimitiveError> {
  if (!Number.isSafeInteger(value) || value < 1) {
    return err(primitiveError("RevisionNumber", `expected integer >= 1, received ${value}`));
  }
  return ok(unsafeBrand<number, "RevisionNumber">(value));
}

/**
 * A schema version of the form `<name>@<major>.<minor>`.
 *
 * The version covers the *semantics* of the payload, not only its shape:
 * operators, fact paths, date semantics and resolver behaviour are all part of
 * what a version promises (Decision: no silent semantic change under an
 * unchanged version).
 */
export type SchemaVersion = Brand<string, "SchemaVersion">;

const SCHEMA_VERSION_PATTERN = /^[a-z][a-z0-9-]*@\d+\.\d+$/u;

export function makeSchemaVersion(value: string): Result<SchemaVersion, PrimitiveError> {
  if (!SCHEMA_VERSION_PATTERN.test(value)) {
    return err(
      primitiveError("SchemaVersion", `expected "<name>@<major>.<minor>", received "${value}"`),
    );
  }
  return ok(unsafeBrand<string, "SchemaVersion">(value));
}

export function schemaVersionConstant(value: string): SchemaVersion {
  return unsafeBrand<string, "SchemaVersion">(value);
}

/** Engine identity, e.g. `1.0.0`. */
export type EngineVersion = Brand<string, "EngineVersion">;

const ENGINE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

export function makeEngineVersion(value: string): Result<EngineVersion, PrimitiveError> {
  if (!ENGINE_VERSION_PATTERN.test(value)) {
    return err(primitiveError("EngineVersion", `expected semver "x.y.z", received "${value}"`));
  }
  return ok(unsafeBrand<string, "EngineVersion">(value));
}

export function engineVersionConstant(value: string): EngineVersion {
  return unsafeBrand<string, "EngineVersion">(value);
}

/**
 * Version of the derived-key format (RequiredProcedureKey /
 * RequiredDocumentKey). Changing the key layout requires bumping this.
 */
export type DerivedKeyFormatVersion = Brand<string, "DerivedKeyFormatVersion">;

const DERIVED_KEY_FORMAT_PATTERN = /^\d+$/u;

export function makeDerivedKeyFormatVersion(
  value: string,
): Result<DerivedKeyFormatVersion, PrimitiveError> {
  if (!DERIVED_KEY_FORMAT_PATTERN.test(value)) {
    return err(
      primitiveError("DerivedKeyFormatVersion", `expected a decimal version, received "${value}"`),
    );
  }
  return ok(unsafeBrand<string, "DerivedKeyFormatVersion">(value));
}

export function derivedKeyFormatVersionConstant(value: string): DerivedKeyFormatVersion {
  return unsafeBrand<string, "DerivedKeyFormatVersion">(value);
}
