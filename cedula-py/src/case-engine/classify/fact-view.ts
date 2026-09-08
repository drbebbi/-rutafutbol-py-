import type { LocalDate } from "../../domain/primitives/local-date";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { OptionalFact } from "../../domain/case/knowledge";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";

/**
 * One cell of the rule fact view.
 *
 * Rules see this - never `UserCaseFacts`. The projection is pure and total:
 * every registered path yields a cell, and every unregistered path is a
 * configuration error long before evaluation.
 */
export type FactCellValue = string | boolean | number | LocalDate | readonly string[];

export type FactCell =
  | Readonly<{ state: "KNOWN"; value: FactCellValue }>
  | Readonly<{ state: "UNKNOWN" }>
  | Readonly<{ state: "UNANSWERED" }>
  | Readonly<{ state: "NOT_APPLICABLE" }>;

export type ScopeBinding = ReadonlyMap<RuleFactPath, FactCell>;

/**
 * A collection the engine iterates over.
 *
 * An UNKNOWN or UNANSWERED collection is *not* an empty list. "I don't know
 * where I have lived" must make residence rules indeterminate, not vacuously
 * satisfied.
 */
export type ScopeCollection =
  | Readonly<{ state: "KNOWN"; entries: readonly ScopeBinding[] }>
  | Readonly<{ state: "UNKNOWN" }>
  | Readonly<{ state: "UNANSWERED" }>;

export type RuleFactView = Readonly<{
  caseCells: ReadonlyMap<RuleFactPath, FactCell>;
  nationalities: ScopeCollection;
  residenceHistory: ScopeCollection;
  documents: ScopeCollection;
}>;

function cellOf<T extends FactCellValue>(fact: OptionalFact<T>): FactCell {
  return fact.state === "KNOWN" ? { state: "KNOWN", value: fact.value } : { state: fact.state };
}

function derivedCitizenship(
  facts: UserCaseFacts,
): Readonly<{ countries: FactCell; count: FactCell }> {
  const nationalities = facts.classification.nationalities;
  if (nationalities.state !== "KNOWN") {
    return { countries: { state: nationalities.state }, count: { state: nationalities.state } };
  }
  const countries = nationalities.value
    .filter((entry) => entry.roles.includes("CITIZENSHIP"))
    .map((entry) => entry.countryCode as string)
    .sort();
  return {
    countries: { state: "KNOWN", value: countries },
    count: { state: "KNOWN", value: countries.length },
  };
}

/**
 * Projects `UserCaseFacts` + execution context into the rule fact view.
 *
 * Pure, total, and deterministic: collections are sorted by their canonical
 * identity so that a different database row order cannot change a decision.
 */
export function projectRuleFactView(
  facts: UserCaseFacts,
  context: EvaluationExecutionContext,
): RuleFactView {
  const classification = facts.classification;
  const citizenship = derivedCitizenship(facts);

  const caseCells = new Map<RuleFactPath, FactCell>();
  caseCells.set("case.desiredProcedure", { state: "KNOWN", value: classification.desiredProcedure });
  caseCells.set("case.adultStatus", cellOf(classification.adultStatus));
  caseCells.set(
    "case.location.kind",
    classification.location.state === "KNOWN"
      ? { state: "KNOWN", value: classification.location.value.kind }
      : { state: classification.location.state },
  );
  caseCells.set(
    "case.location.countryCode",
    classification.location.state === "KNOWN"
      ? classification.location.value.countryCode === null
        ? { state: "NOT_APPLICABLE" }
        : { state: "KNOWN", value: classification.location.value.countryCode as string }
      : { state: classification.location.state },
  );
  caseCells.set("case.maritalStatus", cellOf(classification.maritalStatus));
  caseCells.set(
    "case.holdsPreviousParaguayanCedula",
    cellOf(classification.holdsPreviousParaguayanCedula),
  );
  caseCells.set("case.residence.reportedType", cellOf(classification.residence.reportedType));
  caseCells.set("case.residence.card.state", cellOf(classification.residence.card.state));
  caseCells.set("case.residence.card.expiryDate", cellOf(classification.residence.card.expiryDate));
  caseCells.set(
    "case.entryTravelDocumentCountry",
    cellOf(classification.entryTravelDocumentCountry),
  );
  caseCells.set(
    "case.processTravelDocumentCountry",
    cellOf(classification.processTravelDocumentCountry),
  );
  caseCells.set("case.citizenshipCountries", citizenship.countries);
  caseCells.set("case.citizenshipCount", citizenship.count);
  caseCells.set(
    "case.specialCase.paraguayanCitizenship",
    cellOf(classification.specialCase.paraguayanCitizenship),
  );
  caseCells.set(
    "case.specialCase.paraguayanParent",
    cellOf(classification.specialCase.paraguayanParent),
  );
  caseCells.set(
    "case.specialCase.paraguayanSpouse",
    cellOf(classification.specialCase.paraguayanSpouse),
  );
  caseCells.set(
    "case.specialCase.repatriadoFamily",
    cellOf(classification.specialCase.repatriadoFamily),
  );
  caseCells.set(
    "case.specialCase.diplomaticStatus",
    cellOf(classification.specialCase.diplomaticStatus),
  );
  caseCells.set(
    "case.specialCase.protectionStatus",
    cellOf(classification.specialCase.protectionStatus),
  );
  caseCells.set(
    "case.specialCase.investorStatus",
    cellOf(classification.specialCase.investorStatus),
  );
  caseCells.set("case.entryEvidence.state", cellOf(facts.readiness.entryEvidence));
  caseCells.set("context.effectiveLocalDate", {
    state: "KNOWN",
    value: context.effectiveLocalDate,
  });

  const nationalities: ScopeCollection =
    classification.nationalities.state === "KNOWN"
      ? {
          state: "KNOWN",
          entries: [...classification.nationalities.value]
            .sort((a, b) => (a.countryCode as string).localeCompare(b.countryCode as string))
            .map((entry) => {
              const binding = new Map<RuleFactPath, FactCell>();
              binding.set("scope.nationality.countryCode", {
                state: "KNOWN",
                value: entry.countryCode as string,
              });
              binding.set("scope.nationality.roles", {
                state: "KNOWN",
                value: [...entry.roles].sort(),
              });
              return binding;
            }),
        }
      : { state: classification.nationalities.state };

  const residenceHistory: ScopeCollection =
    classification.residenceHistory.state === "KNOWN"
      ? {
          state: "KNOWN",
          entries: [...classification.residenceHistory.value]
            .sort((a, b) => {
              const key = (value: typeof a): string =>
                `${value.from as string}|${value.to === null ? "~" : (value.to as string)}|${value.countryCode as string}`;
              return key(a).localeCompare(key(b));
            })
            .map((entry) => {
              const binding = new Map<RuleFactPath, FactCell>();
              binding.set("scope.residenceHistory.countryCode", {
                state: "KNOWN",
                value: entry.countryCode as string,
              });
              binding.set("scope.residenceHistory.from", { state: "KNOWN", value: entry.from });
              binding.set(
                "scope.residenceHistory.to",
                // An ongoing stay is modelled as NOT_APPLICABLE, which
                // INTERVAL_OVERLAP_AT_LEAST understands explicitly.
                entry.to === null ? { state: "NOT_APPLICABLE" } : { state: "KNOWN", value: entry.to },
              );
              return binding;
            }),
        }
      : { state: classification.residenceHistory.state };

  const documents: ScopeCollection =
    facts.readiness.documents.state === "KNOWN"
      ? {
          state: "KNOWN",
          entries: [...facts.readiness.documents.value]
            .sort((a, b) => (a.instanceId as string).localeCompare(b.instanceId as string))
            .map((entry) => {
              const binding = new Map<RuleFactPath, FactCell>();
              binding.set("scope.document.documentTypeId", {
                state: "KNOWN",
                value: entry.documentTypeId as string,
              });
              binding.set("scope.document.issuingCountry", cellOf(entry.issuingCountry));
              binding.set("scope.document.issueDate", cellOf(entry.issueDate));
              binding.set("scope.document.expiryDate", cellOf(entry.expiryDate));
              binding.set("scope.document.language", cellOf(entry.language));
              binding.set("scope.document.readinessStatus", {
                state: "KNOWN",
                value: entry.readinessStatus,
              });
              return binding;
            }),
        }
      : { state: facts.readiness.documents.state };

  return { caseCells, nationalities, residenceHistory, documents };
}
