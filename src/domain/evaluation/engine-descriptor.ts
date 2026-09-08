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
  /**
   * Which authored schema versions this build can interpret.
   *
   * One list per authored artefact, because they version independently: a
   * change to the rule payload does not have to invalidate every pathway
   * definition. A bundle carrying a version that is not listed is rejected,
   * rather than parsed by a reader that does not know what changed.
   */
  supportedRulePayloadSchemaVersions: readonly SchemaVersion[];
  supportedProductPolicySchemaVersions: readonly SchemaVersion[];
  supportedPathwaySchemaVersions: readonly SchemaVersion[];
  derivedKeyFormatVersion: DerivedKeyFormatVersion;
  evaluationSchemaVersion: SchemaVersion;
}>;

/**
 * Deduplicates and orders a supported-version list.
 *
 * The descriptor takes part in compatibility checks and is reported alongside
 * stored evaluations, so two builds that support the same versions must
 * produce byte-identical descriptors regardless of the order the constants
 * happened to be listed in.
 */
export function canonicalSchemaVersions(
  versions: readonly SchemaVersion[],
): readonly SchemaVersion[] {
  return [...new Set(versions.map((version) => version as string))]
    .sort()
    .map((version) => version as SchemaVersion);
}

/** Whether this engine can interpret an authored artefact's schema version. */
export function supportsSchemaVersion(
  supported: readonly SchemaVersion[],
  version: SchemaVersion,
): boolean {
  return supported.some((entry) => (entry as string) === (version as string));
}

export const CURRENT_ENGINE_VERSION: EngineVersion = engineVersionConstant("1.0.0");
export const CURRENT_DERIVED_KEY_FORMAT_VERSION: DerivedKeyFormatVersion =
  derivedKeyFormatVersionConstant("1");
export const CURRENT_EVALUATION_SCHEMA_VERSION: SchemaVersion =
  schemaVersionConstant("case-evaluation-decision@2.0");

export const CURRENT_ENGINE_DESCRIPTOR: EngineDescriptor = {
  engineVersion: CURRENT_ENGINE_VERSION,
  supportedRulePayloadSchemaVersions: canonicalSchemaVersions([
    schemaVersionConstant("rule-payload@2.0"),
  ]),
  supportedProductPolicySchemaVersions: canonicalSchemaVersions([
    schemaVersionConstant("product-policy@1.0"),
  ]),
  supportedPathwaySchemaVersions: canonicalSchemaVersions([
    schemaVersionConstant("pathway-definition@1.0"),
  ]),
  derivedKeyFormatVersion: CURRENT_DERIVED_KEY_FORMAT_VERSION,
  evaluationSchemaVersion: CURRENT_EVALUATION_SCHEMA_VERSION,
};
