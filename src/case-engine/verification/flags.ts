import type {
  FeeComponentCode,
  RequiredDocumentKey,
  RequiredProcedureKey,
  VisaPurposeCode,
} from "../../domain/identifiers/identifiers";
import type {
  VerificationFlag,
  VerificationTarget,
  VerificationTargetKind,
} from "../../domain/evaluation/issues";
import { compareStrings } from "../canonicalization/ordering";
import type { SlotVerification } from "../precedence/resolve-slot";

/** Concrete targets a slot can offer to a verification declaration. */
export type AvailableTarget = Readonly<{
  procedureKey?: RequiredProcedureKey;
  documentKey?: RequiredDocumentKey;
  componentCode?: FeeComponentCode;
  purposeCode?: VisaPurposeCode;
}>;

/**
 * Honours the rule's declared target kind whenever the slot can supply it, and
 * falls back to CASE otherwise - so a verification request always points at
 * something the user interface can actually show.
 */
export function verificationTargetFor(
  kind: VerificationTargetKind,
  available: AvailableTarget,
): VerificationTarget {
  switch (kind) {
    case "PROCEDURE":
      return available.procedureKey === undefined
        ? { kind: "CASE" }
        : { kind: "PROCEDURE", procedureKey: available.procedureKey };
    case "DOCUMENT":
      return available.documentKey === undefined
        ? { kind: "CASE" }
        : { kind: "DOCUMENT", documentKey: available.documentKey };
    case "VISA_PURPOSE":
      return available.purposeCode === undefined
        ? { kind: "CASE" }
        : { kind: "VISA_PURPOSE", purposeCode: available.purposeCode };
    case "FEE_COMPONENT":
      return available.procedureKey === undefined || available.componentCode === undefined
        ? { kind: "CASE" }
        : {
            kind: "FEE_COMPONENT",
            procedureKey: available.procedureKey,
            componentCode: available.componentCode,
          };
    case "CASE":
      return { kind: "CASE" };
  }
}

export function toVerificationFlag(
  verification: SlotVerification,
  available: AvailableTarget,
): VerificationFlag {
  return {
    code: verification.verification.code,
    target: verificationTargetFor(verification.verification.targetKind, available),
    reason: verification.reason,
    provenance: [verification.provenance],
  };
}

/** Canonical identity of a verification flag, used for dedupe and ordering. */
export function verificationFlagKey(flag: VerificationFlag): string {
  const target = flag.target;
  const targetKey =
    target.kind === "PROCEDURE"
      ? `PROCEDURE:${target.procedureKey as string}`
      : target.kind === "DOCUMENT"
        ? `DOCUMENT:${target.documentKey as string}`
        : target.kind === "VISA_PURPOSE"
          ? `VISA_PURPOSE:${target.purposeCode as string}`
          : target.kind === "FEE_COMPONENT"
            ? `FEE_COMPONENT:${target.procedureKey as string}:${target.componentCode as string}`
            : "CASE";
  return `${flag.code}|${targetKey}|${flag.reason}`;
}

export function canonicalVerificationFlags(
  flags: readonly VerificationFlag[],
): readonly VerificationFlag[] {
  const byKey = new Map<string, VerificationFlag>();
  for (const flag of flags) {
    const key = verificationFlagKey(flag);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, flag);
      continue;
    }
    byKey.set(key, { ...existing, provenance: [...existing.provenance, ...flag.provenance] });
  }
  return [...byKey.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([, flag]) => flag);
}
