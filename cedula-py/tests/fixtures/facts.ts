import type {
  CaseClassificationFacts,
  CaseReadinessFacts,
  SpecialCaseAnswers,
  UserCaseFacts,
} from "../../src/domain/case/user-case-facts";
import { USER_CASE_FACTS_SCHEMA_VERSION } from "../../src/domain/case/user-case-facts";
import { knownFact, unansweredFact } from "../../src/domain/case/knowledge";
import type { CountryCode } from "../../src/domain/primitives/country";
import { id } from "./ids";

/**
 * Synthetic user facts.
 *
 * These describe *applicants*, not law. Nothing here encodes a legal
 * requirement, so the fixtures can be freely invented without asserting
 * anything about Paraguayan procedure.
 */
export const noSpecialCase: SpecialCaseAnswers = {
  paraguayanCitizenship: knownFact(false),
  paraguayanParent: knownFact(false),
  paraguayanSpouse: knownFact(false),
  repatriadoFamily: knownFact(false),
  diplomaticStatus: knownFact(false),
  protectionStatus: knownFact(false),
  investorStatus: knownFact(false),
};

export const unansweredSpecialCase: SpecialCaseAnswers = {
  paraguayanCitizenship: unansweredFact,
  paraguayanParent: unansweredFact,
  paraguayanSpouse: unansweredFact,
  repatriadoFamily: unansweredFact,
  diplomaticStatus: unansweredFact,
  protectionStatus: unansweredFact,
  investorStatus: unansweredFact,
};

export function country(code: string): CountryCode {
  return id<"CountryCode">(code) as unknown as CountryCode;
}

export function baseClassificationFacts(): CaseClassificationFacts {
  return {
    desiredProcedure: "FIRST_CEDULA",
    adultStatus: knownFact("ADULT"),
    location: knownFact({ kind: "IN_PARAGUAY", countryCode: country("PY") }),
    maritalStatus: knownFact("SINGLE"),
    holdsPreviousParaguayanCedula: knownFact(false),
    nationalities: knownFact([
      { countryCode: country("DE"), roles: ["CITIZENSHIP", "ENTRY_TRAVEL_DOCUMENT", "PROCESS_TRAVEL_DOCUMENT"] },
    ]),
    residence: {
      reportedType: knownFact("TEMPORAL"),
      card: { state: knownFact("HELD_VALID"), expiryDate: knownFact("2027-01-01" as never) },
    },
    residenceHistory: knownFact([
      { countryCode: country("PY"), from: "2024-01-01" as never, to: null },
    ]),
    entryTravelDocumentCountry: knownFact(country("DE")),
    processTravelDocumentCountry: knownFact(country("DE")),
    specialCase: noSpecialCase,
  };
}

export function baseReadinessFacts(): CaseReadinessFacts {
  return {
    documents: knownFact([]),
    entryEvidence: knownFact("STAMP_AVAILABLE"),
  };
}

export function userCaseFacts(
  classification: Partial<CaseClassificationFacts> = {},
  readiness: Partial<CaseReadinessFacts> = {},
): UserCaseFacts {
  return {
    factsSchemaVersion: USER_CASE_FACTS_SCHEMA_VERSION,
    classification: { ...baseClassificationFacts(), ...classification },
    readiness: { ...baseReadinessFacts(), ...readiness },
  };
}
