import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { Fact } from "../../domain/case/knowledge";

export type SpecialCaseSignal =
  | "PARAGUAYAN_CITIZENSHIP"
  | "MINOR"
  | "PARAGUAYAN_PARENT"
  | "PARAGUAYAN_SPOUSE"
  | "REPATRIADO_FAMILY"
  | "DIPLOMATIC"
  | "PROTECTION"
  | "INVESTOR";

/**
 * CONFIRMED           - at least one special-case signal is answered "yes".
 * POSSIBLE_UNANSWERED - no "yes", but at least one signal is still open.
 * NONE                - every signal is answered "no".
 */
export type SpecialCaseGuardState = "CONFIRMED" | "POSSIBLE_UNANSWERED" | "NONE";

export type SpecialCaseGuardResult = Readonly<{
  state: SpecialCaseGuardState;
  signals: readonly SpecialCaseSignal[];
}>;

/**
 * Structural guard run *before* a case can be terminated as out of product
 * scope.
 *
 * A Paraguayan citizen, a minor, the spouse or child of a Paraguayan, a
 * repatriado family member, a diplomat, a person under protection or an
 * investor must not be told "your country is not supported" just because the
 * country matrix says so. The guard reads answers the user gave directly - it
 * asserts no legal consequence of its own.
 */
export function knownSpecialCaseGuard(facts: UserCaseFacts): SpecialCaseGuardResult {
  const special = facts.classification.specialCase;
  const entries: readonly (readonly [SpecialCaseSignal, Fact<boolean>])[] = [
    ["PARAGUAYAN_CITIZENSHIP", special.paraguayanCitizenship],
    ["PARAGUAYAN_PARENT", special.paraguayanParent],
    ["PARAGUAYAN_SPOUSE", special.paraguayanSpouse],
    ["REPATRIADO_FAMILY", special.repatriadoFamily],
    ["DIPLOMATIC", special.diplomaticStatus],
    ["PROTECTION", special.protectionStatus],
    ["INVESTOR", special.investorStatus],
  ];

  const confirmed: SpecialCaseSignal[] = [];
  let anyOpen = false;

  const adultStatus = facts.classification.adultStatus;
  if (adultStatus.state === "KNOWN") {
    if (adultStatus.value === "MINOR") {
      confirmed.push("MINOR");
    }
  } else {
    anyOpen = true;
  }

  for (const [signal, fact] of entries) {
    if (fact.state === "KNOWN") {
      if (fact.value) {
        confirmed.push(signal);
      }
      continue;
    }
    anyOpen = true;
  }

  if (confirmed.length > 0) {
    return { state: "CONFIRMED", signals: [...confirmed].sort() };
  }
  return { state: anyOpen ? "POSSIBLE_UNANSWERED" : "NONE", signals: [] };
}
