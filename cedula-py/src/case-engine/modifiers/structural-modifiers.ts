import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { CaseModifier } from "../../domain/evaluation/issues";
import { compareStrings } from "../canonicalization/ordering";
import type { VisaDecision } from "../classify/classification-stage";
import type { SpecialCaseGuardResult } from "../classify/special-case-guard";

/**
 * Structural modifiers are derived directly from the facts.
 *
 * They carry no provenance because no rule stated them: they are observations
 * about the input, not legal conclusions. Legal modifiers (currently the visa
 * outcome) are added separately and do carry provenance.
 */
export function deriveStructuralModifiers(
  facts: UserCaseFacts,
  guard: SpecialCaseGuardResult,
): readonly CaseModifier[] {
  const modifiers: CaseModifier[] = [];
  const classification = facts.classification;

  if (classification.adultStatus.state === "KNOWN" && classification.adultStatus.value === "MINOR") {
    modifiers.push({ code: "MINOR_APPLICANT", qualifier: null, provenance: [] });
  }

  if (classification.nationalities.state === "KNOWN") {
    const citizenships = classification.nationalities.value.filter((entry) =>
      entry.roles.includes("CITIZENSHIP"),
    );
    if (citizenships.length > 1) {
      modifiers.push({ code: "MULTIPLE_CITIZENSHIPS", qualifier: null, provenance: [] });
    }
    if (citizenships.some((entry) => (entry.countryCode as string) === "PY")) {
      modifiers.push({ code: "PARAGUAYAN_CITIZENSHIP_DECLARED", qualifier: null, provenance: [] });
    }
  }
  if (
    guard.signals.includes("PARAGUAYAN_CITIZENSHIP") &&
    !modifiers.some((modifier) => modifier.code === "PARAGUAYAN_CITIZENSHIP_DECLARED")
  ) {
    modifiers.push({ code: "PARAGUAYAN_CITIZENSHIP_DECLARED", qualifier: null, provenance: [] });
  }

  if (classification.location.state === "KNOWN") {
    modifiers.push({
      code: classification.location.value.kind === "IN_PARAGUAY" ? "APPLICANT_IN_PARAGUAY" : "APPLICANT_ABROAD",
      qualifier: null,
      provenance: [],
    });
  }

  if (
    classification.residence.card.state.state === "KNOWN" &&
    classification.residence.card.state.value === "HELD_EXPIRED"
  ) {
    modifiers.push({ code: "RESIDENCE_CARD_EXPIRED", qualifier: null, provenance: [] });
  }

  const entry = classification.entryTravelDocumentCountry;
  const process = classification.processTravelDocumentCountry;
  if (entry.state === "KNOWN" && process.state === "KNOWN" && entry.value !== process.value) {
    modifiers.push({
      code: "PROCESS_DOCUMENT_DIFFERS_FROM_ENTRY_DOCUMENT",
      qualifier: null,
      provenance: [],
    });
  }

  return modifiers;
}

export function visaModifiers(decisions: readonly VisaDecision[]): readonly CaseModifier[] {
  return decisions.map((decision) => ({
    code: decision.requirement === "REQUIRED" ? ("VISA_REQUIRED" as const) : ("VISA_NOT_REQUIRED" as const),
    qualifier: decision.purposeCode as string,
    provenance: decision.provenance,
  }));
}

/** Canonical modifier ordering and dedupe. */
export function canonicalModifiers(modifiers: readonly CaseModifier[]): readonly CaseModifier[] {
  const byKey = new Map<string, CaseModifier>();
  for (const modifier of modifiers) {
    const key = `${modifier.code}|${modifier.qualifier ?? "-"}`;
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing === undefined
        ? modifier
        : { ...existing, provenance: [...existing.provenance, ...modifier.provenance] },
    );
  }
  return [...byKey.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([, modifier]) => modifier);
}
