import { err, ok, type Result } from "../../shared/result/result";
import type { DerivedKeyFormatVersion } from "../../domain/primitives/versioning";
import {
  unsafeRequiredDocumentKey,
  unsafeRequiredProcedureKey,
  type RequiredDocumentKey,
  type RequiredProcedureKey,
} from "../../domain/identifiers/identifiers";
import type {
  ProcedureParameter,
  RequiredProcedureIdentity,
} from "../../domain/procedures/procedure";
import type { RequiredDocumentIdentity } from "../../domain/documents/required-document";
import { engineInvariantViolation, type EngineError } from "../errors/engine-error";

/**
 * Derived-key format version 1.
 *
 * Keys are a deterministic function of semantic content only. They must never
 * be random, never derive from array position, and never contain a rule
 * revision id - two rules that require the same thing have to produce the same
 * key so that their statements merge instead of duplicating.
 */
export const DERIVED_KEY_FORMAT_V1 = "1";

const FIELD_SEPARATOR = "|";
const PARAMETER_SEPARATOR = ";";
const ABSENT = "-";

function encodeSegment(value: string): string {
  // Percent-encoding keeps the separators unambiguous without inventing an
  // escaping scheme of our own.
  return encodeURIComponent(value);
}

/** Canonical parameter rendering: sorted by name, type-tagged, encoded. */
export function canonicalParameters(parameters: readonly ProcedureParameter[]): string {
  return [...parameters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((parameter) => {
      const tag =
        parameter.value.kind === "STRING" ? "s" : parameter.value.kind === "INTEGER" ? "i" : "b";
      const rendered =
        parameter.value.kind === "BOOLEAN"
          ? parameter.value.value
            ? "true"
            : "false"
          : String(parameter.value.value);
      return `${encodeSegment(parameter.name)}=${tag}:${encodeSegment(rendered)}`;
    })
    .join(PARAMETER_SEPARATOR);
}

function assertFormatVersion(version: DerivedKeyFormatVersion): EngineError | null {
  return (version as string) === DERIVED_KEY_FORMAT_V1
    ? null
    : engineInvariantViolation(
        "DERIVED_KEY_FORMAT_MISMATCH",
        `engine implements derived key format ${DERIVED_KEY_FORMAT_V1}, descriptor asks for ${version}`,
      );
}

export function makeRequiredProcedureKey(
  identity: RequiredProcedureIdentity,
  formatVersion: DerivedKeyFormatVersion,
): Result<RequiredProcedureKey, EngineError> {
  const mismatch = assertFormatVersion(formatVersion);
  if (mismatch !== null) {
    return err(mismatch);
  }
  const parts = [
    encodeSegment(identity.procedureId as string),
    canonicalParameters(identity.parameters),
    identity.discriminator === null ? ABSENT : encodeSegment(identity.discriminator),
  ];
  return ok(unsafeRequiredProcedureKey(`rp1:${parts.join(FIELD_SEPARATOR)}`));
}

export function makeRequiredDocumentKey(
  identity: RequiredDocumentIdentity,
  formatVersion: DerivedKeyFormatVersion,
): Result<RequiredDocumentKey, EngineError> {
  const mismatch = assertFormatVersion(formatVersion);
  if (mismatch !== null) {
    return err(mismatch);
  }
  const parts = [
    encodeSegment(identity.forProcedure as string),
    encodeSegment(identity.documentTypeId as string),
    identity.issuingCountry === null ? ABSENT : encodeSegment(identity.issuingCountry as string),
    identity.discriminator === null ? ABSENT : encodeSegment(identity.discriminator),
  ];
  return ok(unsafeRequiredDocumentKey(`rd1:${parts.join(FIELD_SEPARATOR)}`));
}
