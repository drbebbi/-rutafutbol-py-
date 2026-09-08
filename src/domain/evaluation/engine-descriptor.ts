import type {
  DerivedKeyFormatVersion,
  EngineVersion,
  SchemaVersion,
} from "../primitives/versioning";
import {
  derivedKeyFormatVersionConstant,
  engineVersionConstant,
  schemaVersionConstant,
} from "../primitives/versioning";

/**
 * Identity of the code that produced a decision.
 *
 * `derivedKeyFormatVersion` is part of the descriptor because
 * RequiredProcedureKey / RequiredDocumentKey layouts are an observable
 * contract: changing them without bumping this version would silently
 * invalidate stored evaluations.
 */
export type EngineDescriptor = Readonly<{
  engineVersion: EngineVersion;
  derivedKeyFormatVersion: DerivedKeyFormatVersion;
  evaluationSchemaVersion: SchemaVersion;
}>;

export const CURRENT_ENGINE_VERSION: EngineVersion = engineVersionConstant("1.0.0");
export const CURRENT_DERIVED_KEY_FORMAT_VERSION: DerivedKeyFormatVersion =
  derivedKeyFormatVersionConstant("1");
export const CURRENT_EVALUATION_SCHEMA_VERSION: SchemaVersion =
  schemaVersionConstant("case-evaluation-decision@1.0");

export const CURRENT_ENGINE_DESCRIPTOR: EngineDescriptor = {
  engineVersion: CURRENT_ENGINE_VERSION,
  derivedKeyFormatVersion: CURRENT_DERIVED_KEY_FORMAT_VERSION,
  evaluationSchemaVersion: CURRENT_EVALUATION_SCHEMA_VERSION,
};
