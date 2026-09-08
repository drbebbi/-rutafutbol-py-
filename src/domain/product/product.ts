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
import type { SchemaVersion } from "../primitives/versioning";
import { schemaVersionConstant } from "../primitives/versioning";
import type { PublicationStatus } from "../rules/publication";
import type { DesiredProcedure } from "../case/user-case-facts";
import type { CaseType } from "../case/classification";
import type { BlockingIssueCode, VerificationCode } from "../evaluation/issues";

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

/** The coverage states a published coverage revision may actually declare. */
export type DeclaredProductCoverageState = Exclude<
  ProductCoverageState,
  "BYPASSED_SPECIAL_CASE" | "INDETERMINATE"
>;

export const DECLARED_PRODUCT_COVERAGE_STATES: readonly DeclaredProductCoverageState[] = [
  "SUPPORTED",
  "PARTIAL",
  "NOT_SUPPORTED",
  "RESEARCH_REQUIRED",
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
  state: DeclaredProductCoverageState;
}>;

export type ProductBlockerCode =
  | "COUNTRY_OUT_OF_SCOPE"
  | "PROCEDURE_OUT_OF_SCOPE"
  | "RESEARCH_INCOMPLETE";

export const PRODUCT_BLOCKER_CODES: readonly ProductBlockerCode[] = [
  "COUNTRY_OUT_OF_SCOPE",
  "PROCEDURE_OUT_OF_SCOPE",
  "RESEARCH_INCOMPLETE",
];

export type ProductWarningCode = "PARTIAL_COVERAGE";

export const PRODUCT_WARNING_CODES: readonly ProductWarningCode[] = ["PARTIAL_COVERAGE"];

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

/** Which coverage revision decided a coverage state. */
export type ProductCoverageProvenance = Readonly<{
  productCoverageId: ProductCoverageId;
  productCoverageRevisionId: ProductCoverageRevisionId;
}>;

/** Which policy revision produced an effect. */
export type ProductPolicyProvenance = Readonly<{
  productPolicyId: ProductPolicyId;
  productPolicyRevisionId: ProductPolicyRevisionId;
  /** The policy rule inside that revision, so the trail reaches one clause. */
  policyRuleKey: string;
}>;

/* -------------------------------------------------------------------------- */
/* Product policy effects                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The closed set of things a ProductPolicy is allowed to do.
 *
 * Read the union as a list of what a product decision *cannot* be: there is no
 * effect that adds a procedure, a document, a formality or a fee, and none
 * that removes or overrides a legal rule. A policy can decline to serve a
 * case, ask for research, ask the applicant something, or warn - and that is
 * the whole vocabulary.
 */
export type ProductUnsupportedEffect = Readonly<{
  kind: "UNSUPPORTED";
  blocker: ProductBlockerCode;
}>;

export type ProductVerificationRequiredEffect = Readonly<{
  kind: "VERIFICATION_REQUIRED";
  code: VerificationCode;
}>;

export type ProductBlockingEffect = Readonly<{
  kind: "BLOCKING";
  /** A question for the applicant, from the same closed registry rules use. */
  code: BlockingIssueCode;
}>;

export type ProductWarningEffect = Readonly<{
  kind: "WARNING";
  code: ProductWarningCode;
}>;

export type ProductPolicyEffect =
  | ProductUnsupportedEffect
  | ProductVerificationRequiredEffect
  | ProductBlockingEffect
  | ProductWarningEffect;

export type ProductPolicyEffectKind = ProductPolicyEffect["kind"];

export const PRODUCT_POLICY_EFFECT_KINDS: readonly ProductPolicyEffectKind[] = [
  "UNSUPPORTED",
  "VERIFICATION_REQUIRED",
  "BLOCKING",
  "WARNING",
];

/** An effect as it appears in a decision, with the policy that produced it. */
export type AppliedProductPolicyEffect = Readonly<{
  effect: ProductPolicyEffect;
  provenance: ProductPolicyProvenance;
}>;

/* -------------------------------------------------------------------------- */
/* Product policy revisions                                                    */
/* -------------------------------------------------------------------------- */

export const PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION: SchemaVersion =
  schemaVersionConstant("product-policy@1.0");

/**
 * When a policy rule applies.
 *
 * A closed matcher over the product policy fact view, not an expression
 * language: product scope decisions are coarse by nature, and giving them
 * their own AST would invite them to grow into a second, unaudited rule
 * engine. An empty list means "any value".
 */
export type ProductPolicyCondition = Readonly<{
  coverageStates: readonly ProductCoverageState[];
  desiredProcedures: readonly DesiredProcedure[];
  countries: readonly CountryCode[];
  caseTypes: readonly CaseType[];
}>;

export type ProductPolicyRule = Readonly<{
  policyRuleKey: string;
  condition: ProductPolicyCondition;
  effect: ProductPolicyEffect;
}>;

export type ProductPolicyPayload = Readonly<{
  /** Desired procedures the product is willing to serve at all. */
  supportedDesiredProcedures: readonly DesiredProcedure[];
  rules: readonly ProductPolicyRule[];
}>;

export type ProductPolicyRevision = Readonly<{
  productPolicyRevisionId: ProductPolicyRevisionId;
  productPolicyId: ProductPolicyId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  payloadSchemaVersion: SchemaVersion;
  payload: ProductPolicyPayload;
}>;

/* -------------------------------------------------------------------------- */
/* Assessment                                                                  */
/* -------------------------------------------------------------------------- */

/** Stage 1: what the product's coverage table says about this case. */
export type ProductCoverageDecision = Readonly<{
  state: ProductCoverageState;
  /**
   * The coverage revisions that decided the state.
   *
   * Empty for states no revision declared: INDETERMINATE (the case has not
   * said which country applies yet) and BYPASSED_SPECIAL_CASE.
   */
  provenance: readonly ProductCoverageProvenance[];
}>;

/** Stage 3: what the product policy did with it. */
export type ProductAssessment = Readonly<{
  coverage: ProductCoverageDecision;
  effects: readonly AppliedProductPolicyEffect[];
}>;

/* -------------------------------------------------------------------------- */
/* Pathways                                                                    */
/* -------------------------------------------------------------------------- */

export const PATHWAY_PAYLOAD_SCHEMA_VERSION: SchemaVersion =
  schemaVersionConstant("pathway-definition@1.0");

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

export type PathwayDefinitionPayload = Readonly<{
  /** Case types this pathway presents. */
  appliesToCaseTypes: readonly string[];
  sections: readonly PathwaySection[];
}>;

export type PathwayDefinitionRevision = Readonly<{
  pathwayDefinitionRevisionId: PathwayDefinitionRevisionId;
  pathwayDefinitionId: PathwayDefinitionId;
  pathwayId: PathwayId;
  publicationStatus: PublicationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  payloadSchemaVersion: SchemaVersion;
  payload: PathwayDefinitionPayload;
}>;

export type PathwayOrdering = Readonly<{
  sectionKey: string;
  procedureKeys: readonly RequiredProcedureKey[];
}>;
