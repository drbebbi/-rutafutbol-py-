import type { VerificationFlag } from "../../domain/evaluation/issues";
import { compareStrings } from "../canonicalization/ordering";

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
