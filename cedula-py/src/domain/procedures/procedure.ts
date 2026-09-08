import type { AuthorityId, ProcedureId, RequiredProcedureKey } from "../identifiers/identifiers";
import type { SupportLevel } from "../rules/verification";
import type { ProvenanceRef } from "../evaluation/provenance";

/** A catalogued administrative procedure. Reference data, not a rule. */
export type Procedure = Readonly<{
  procedureId: ProcedureId;
  authorityId: AuthorityId;
  /** Stable machine label; user-facing copy lives in the UI layer. */
  label: string;
}>;

/**
 * A resolved semantic parameter of a required procedure.
 *
 * Parameter values participate in the procedure's semantic identity, so they
 * are restricted to canonically serialisable scalars.
 */
export type ProcedureParameterValue =
  | Readonly<{ kind: "STRING"; value: string }>
  | Readonly<{ kind: "INTEGER"; value: number }>
  | Readonly<{ kind: "BOOLEAN"; value: boolean }>;

export type ProcedureParameter = Readonly<{
  name: string;
  value: ProcedureParameterValue;
}>;

/**
 * Semantic identity of a required procedure.
 *
 * Identity is content, never position: not a scope index, not the rule
 * revision that produced it, not a database row, not an array index. Two rules
 * that require "apostille of the birth certificate issued in DE" produce the
 * same key and merge.
 */
export type RequiredProcedureIdentity = Readonly<{
  procedureId: ProcedureId;
  parameters: readonly ProcedureParameter[];
  /** Explicit discriminator for procedures that repeat with the same params. */
  discriminator: string | null;
}>;

export type RequiredProcedure = Readonly<{
  key: RequiredProcedureKey;
  identity: RequiredProcedureIdentity;
  support: SupportLevel;
  provenance: readonly ProvenanceRef[];
}>;

export type RequiredProcedureDependency = Readonly<{
  /** The dependent procedure - it can only be done after `dependsOn`. */
  dependent: RequiredProcedureKey;
  dependsOn: RequiredProcedureKey;
  support: SupportLevel;
  provenance: readonly ProvenanceRef[];
}>;
