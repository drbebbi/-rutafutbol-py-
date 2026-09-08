import type { CountryCode } from "../primitives/country";
import type { SchemaVersion } from "../primitives/versioning";
import type { NationalityFacts } from "../nationality/nationality";
import type { ResidenceFacts, ResidenceHistoryEntry } from "../residence/residence";
import type { DocumentInstanceFacts } from "../documents/document-facts";
import type { Fact, OptionalFact } from "./knowledge";

export const USER_CASE_FACTS_SCHEMA_VERSION = "user-case-facts@1.0" as SchemaVersion;

/**
 * The procedure the user actually wants.
 *
 * This is the ONE authoritative statement of intent in the whole system
 * (cross-phase amendment: single source of truth). `EvaluationContext`
 * deliberately carries no second `requestedProcedure` field, so the two can
 * never disagree.
 */
export type DesiredProcedure = "FIRST_CEDULA" | "CEDULA_RENEWAL" | "CEDULA_REPLACEMENT";

export const DESIRED_PROCEDURES: readonly DesiredProcedure[] = [
  "FIRST_CEDULA",
  "CEDULA_RENEWAL",
  "CEDULA_REPLACEMENT",
];

export type AdultStatus = "ADULT" | "MINOR";

export type MaritalStatus = "SINGLE" | "MARRIED" | "CIVIL_UNION" | "DIVORCED" | "WIDOWED";

export const MARITAL_STATUSES: readonly MaritalStatus[] = [
  "SINGLE",
  "MARRIED",
  "CIVIL_UNION",
  "DIVORCED",
  "WIDOWED",
];

export type ApplicantLocationKind = "IN_PARAGUAY" | "ABROAD";

export type ApplicantLocation = Readonly<{
  kind: ApplicantLocationKind;
  /** The country the applicant is currently in; `null` when unmodelled. */
  countryCode: CountryCode | null;
}>;

/**
 * Closed set of special-case signals asked directly of the user.
 *
 * These are PERSONAL_HIGH_RISK facts. They exist so that a case which happens
 * to fall outside the product's country scope is not terminated as a plain
 * COUNTRY_NOT_SUPPORTED when a known special case may apply to it.
 */
export type SpecialCaseAnswers = Readonly<{
  paraguayanCitizenship: Fact<boolean>;
  paraguayanParent: Fact<boolean>;
  paraguayanSpouse: Fact<boolean>;
  repatriadoFamily: Fact<boolean>;
  diplomaticStatus: Fact<boolean>;
  protectionStatus: Fact<boolean>;
  investorStatus: Fact<boolean>;
}>;

/**
 * Legal-classification facts.
 *
 * Nothing in here may describe how far along the user is in collecting papers.
 * Whether a document is already in hand belongs to `CaseReadinessFacts`.
 */
export type CaseClassificationFacts = Readonly<{
  desiredProcedure: DesiredProcedure;
  adultStatus: Fact<AdultStatus>;
  location: Fact<ApplicantLocation>;
  maritalStatus: Fact<MaritalStatus>;
  holdsPreviousParaguayanCedula: Fact<boolean>;
  nationalities: Fact<readonly NationalityFacts[]>;
  residence: ResidenceFacts;
  residenceHistory: Fact<readonly ResidenceHistoryEntry[]>;
  entryTravelDocumentCountry: OptionalFact<CountryCode>;
  processTravelDocumentCountry: OptionalFact<CountryCode>;
  specialCase: SpecialCaseAnswers;
}>;

/** How the applicant entered / can evidence their entry. Readiness, not law. */
export type EntryEvidenceState = "NOT_PROVIDED" | "STAMP_AVAILABLE" | "STAMP_MISSING";

export type CaseReadinessFacts = Readonly<{
  documents: Fact<readonly DocumentInstanceFacts[]>;
  entryEvidence: Fact<EntryEvidenceState>;
}>;

export type UserCaseFacts = Readonly<{
  factsSchemaVersion: SchemaVersion;
  classification: CaseClassificationFacts;
  readiness: CaseReadinessFacts;
}>;
