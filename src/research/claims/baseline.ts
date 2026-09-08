import type { CountryCode } from "../../domain/primitives/country";
import type { Money } from "../../domain/primitives/money";
import { currencyCodeConstant } from "../../domain/primitives/money";
import type { VerificationStatus } from "../../domain/rules/verification";

/**
 * The approved research baseline, as REFERENCE DATA.
 *
 * Nothing in this module is a rule and nothing here is loaded by the engine.
 * It exists so Phase 4 can author rules from a single reviewed list instead of
 * from prose, and so the implementation report can state exactly which
 * production content was carried in.
 *
 * The rule that governs this file: if a value is not in the approved baseline,
 * it does not go in. There is no "reasonable assumption" entry.
 */
const PYG = currencyCodeConstant("PYG");

function guaranies(amount: number): Money {
  return { amountMinorUnits: amount, currency: PYG };
}

export type BaselineFact<T> = Readonly<{
  key: string;
  value: T;
  status: VerificationStatus;
  note: string;
}>;

/** Published official fees. */
export const BASELINE_FEES: readonly BaselineFact<Money>[] = [
  {
    key: "cedula.first.foreigner",
    value: guaranies(8500),
    status: "STRONG_EVIDENCE",
    note: "Published first-time foreigner cedula fee. Carried as reference data only.",
  },
  {
    key: "dnm.residencia-temporal",
    value: guaranies(2926925),
    status: "STRONG_EVIDENCE",
    note: "Current published DNM fee for Residencia Temporal.",
  },
  {
    key: "dnm.residencia-permanente",
    value: guaranies(2926925),
    status: "STRONG_EVIDENCE",
    note: "Current published DNM fee for Residencia Permanente.",
  },
  {
    key: "dnm.certificado-radicacion",
    value: guaranies(234154),
    status: "STRONG_EVIDENCE",
    note: "Current published DNM fee for the Certificado de Radicacion.",
  },
  {
    key: "dnm.prorroga-temporal",
    value: guaranies(1287847),
    status: "STRONG_EVIDENCE",
    note: "Current published DNM fee for a Prorroga of a temporal residence.",
  },
  {
    key: "dnm.multa",
    value: guaranies(702462),
    status: "STRONG_EVIDENCE",
    note: "Current published DNM fine.",
  },
];

/** The daily-wage index many official fees are expressed against. */
export const BASELINE_JORNAL: BaselineFact<Money> = {
  key: "index.jornal",
  value: guaranies(117077),
  status: "STRONG_EVIDENCE",
  note: "Jornal baseline used as the unit of indexed official fees.",
};

export type VisaRequirement = "REQUIRED" | "NO_VISA";

/**
 * Europe MVP visa matrix (residence purpose).
 *
 * Country scope only; nothing here says what an applicant must then do.
 */
export const BASELINE_EUROPE_VISA_MATRIX: readonly BaselineFact<VisaRequirement>[] = [
  { key: "AT", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "Austria" },
  { key: "BE", value: "NO_VISA", status: "STRONG_EVIDENCE", note: "Belgium" },
  { key: "CH", value: "NO_VISA", status: "STRONG_EVIDENCE", note: "Switzerland" },
  { key: "DE", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "Germany, residence purpose" },
  { key: "ES", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "Spain" },
  { key: "FR", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "France" },
  { key: "GB", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "United Kingdom" },
  { key: "IT", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "Italy" },
  { key: "NL", value: "NO_VISA", status: "STRONG_EVIDENCE", note: "Netherlands" },
  { key: "PT", value: "REQUIRED", status: "STRONG_EVIDENCE", note: "Portugal" },
];

/** Narrative baseline statements that are established but not yet rule-shaped. */
export const BASELINE_STATEMENTS: readonly BaselineFact<string>[] = [
  {
    key: "residencia-temporal.legal-basis",
    value: "Residencia Temporal is governed by Ley 6984/2022.",
    status: "CONFIRMED",
    note: "Legal basis of the temporal residence regime.",
  },
  {
    key: "residencia-temporal.duration",
    value: "Residencia Temporal is generally granted for up to two years.",
    status: "STRONG_EVIDENCE",
    note: "General duration, not a per-case guarantee.",
  },
  {
    key: "residencia-temporal.cedula-access",
    value: "Residencia Temporal can in principle provide access to a cedula.",
    status: "STRONG_EVIDENCE",
    note: "Established in principle; the exact document set is not.",
  },
  {
    key: "residencia.temporal-to-permanente",
    value: "A general pathway exists from Residencia Temporal to Residencia Permanente.",
    status: "STRONG_EVIDENCE",
    note: "Pathway exists; conditions are not modelled here.",
  },
  {
    key: "cedula.delivery-indication",
    value: "Published cedula delivery indication: 90 business days.",
    status: "STRONG_EVIDENCE",
    note: "An indication, not a guaranteed processing time.",
  },
];

/**
 * The open conflict. Recorded, never resolved by substitution.
 *
 * The Identificaciones publication covering first-cedula issuance is titled for
 * temporal AND permanent residents, yet its published document list names
 * permanent-residence documents (Certificado de Radicacion Permanente, Carnet
 * de Admision Permanente). The exact temporal document set under Resolucion
 * 717/26 is therefore CONFLICTING and requires official verification.
 */
export const TEMPORAL_IDENTIFICACIONES_CONFLICT = {
  key: "temporal-identificaciones-document-set",
  status: "CONFLICTING" as VerificationStatus,
  requiresOfficialVerification: true,
  mustNotBeResolvedBy: "substituting PERMANENTE with TEMPORAL",
  note:
    "Established: Residencia Temporal can open the way to a cedula. Not established: which documents Identificaciones requires from a temporal resident.",
} as const;

export function visaRequirementFor(countryCode: CountryCode): VisaRequirement | null {
  const found = BASELINE_EUROPE_VISA_MATRIX.find((entry) => entry.key === (countryCode as string));
  return found === undefined ? null : found.value;
}
