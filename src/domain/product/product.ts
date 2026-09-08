import type {
  PathwayDefinitionId,
  PathwayDefinitionRevisionId,
  PathwayId,
  ProductCoverageId,
  ProductCoverageRevisionId,
  ProductPolicyId,
  ProductPolicyRevisionId,
  RequiredProcedureKey,
} from "../identifiers/identifiers";
import type { CountryCode } from "../primitives/country";
import type { LocalDate } from "../primitives/local-date";
import type { PublicationStatus } from "../rules/publication";
import type { DesiredProcedure } from "../case/user-case-facts";

/**
 * Internal product coverage states.
 *
 * These describe what *the product* is prepared to do, never what the law
 * says. A ProductPolicy may refuse to serve a case; it may never create a
 * required procedure, a required document, an official fee or a legal
 * formality, and it may never displace a legal rule.
 */
export type ProductCoverageState =
  | "SUPPORTED"
  | "PARTIAL"
  | "NOT_SUPPORTED"
  | "RESEARCH_REQUIRED"
  | "INDETERMINATE"
  | "BYPASSED_SPECIAL_CASE";

export const PRODUCT_COVERAGE_STATES: readonly ProductCoverageState[] = [
  "SUPPORTED",
  "PARTIAL",
  "NOT_SUPPORTED",
  "RESEARCH_REQUIRED",
  "INDETERMINATE",
  "BYPASSED_SPECIAL_CASE",
];

export type ProductCoverageRevision = Readonly<{
  productCoverageRevisionId: ProductCoverageRevisionId;
  productCoverageId: ProductCoverageId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  /** Coverage is declared per (country, desired procedure) pair. */
  countryCode: CountryCode;
  desiredProcedure: DesiredProcedure;
  state: Exclude<ProductCoverageState, "BYPASSED_SPECIAL_CASE" | "INDETERMINATE">;
}>;

export type ProductBlockerCode =
  | "COUNTRY_OUT_OF_SCOPE"
  | "PROCEDURE_OUT_OF_SCOPE"
  | "RESEARCH_INCOMPLETE";

export type ProductWarningCode = "PARTIAL_COVERAGE";

export type ProductPolicyRevision = Readonly<{
  productPolicyRevisionId: ProductPolicyRevisionId;
  productPolicyId: ProductPolicyId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  /** Desired procedures the product is willing to serve at all. */
  supportedDesiredProcedures: readonly DesiredProcedure[];
}>;

export type ProductAssessment = Readonly<{
  coverageState: ProductCoverageState;
  blockers: readonly ProductBlockerCode[];
  warnings: readonly ProductWarningCode[];
}>;

/* -------------------------------------------------------------------------- */
/* Pathways                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A pathway organises presentation only: which sections exist, how required
 * procedures are grouped, in what order they are shown. It must never change a
 * legal requirement, and its ordering must not contradict the dependency DAG.
 */
export type PathwaySection = Readonly<{
  sectionKey: string;
  order: number;
  procedureKeyPatterns: readonly string[];
}>;

export type PathwayDefinitionRevision = Readonly<{
  pathwayDefinitionRevisionId: PathwayDefinitionRevisionId;
  pathwayDefinitionId: PathwayDefinitionId;
  pathwayId: PathwayId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  /** Case types this pathway presents. */
  appliesToCaseTypes: readonly string[];
  sections: readonly PathwaySection[];
}>;

export type PathwayOrdering = Readonly<{
  sectionKey: string;
  procedureKeys: readonly RequiredProcedureKey[];
}>;
