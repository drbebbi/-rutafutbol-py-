import type {
  ExternalCostCode,
  FeeComponentCode,
  FeeIndexId,
  FeeIndexRevisionId,
  RequiredProcedureKey,
} from "../identifiers/identifiers";
import type { CurrencyCode, Money } from "../primitives/money";
import type { LocalDate } from "../primitives/local-date";
import type { PublicationStatus } from "../rules/publication";
import type { SupportLevel, VerificationStatus } from "../rules/verification";
import type { ProvenanceRef } from "../evaluation/provenance";

export type FeeType = "FIXED_AMOUNT" | "INDEXED_AMOUNT" | "EXTERNAL_OR_VARIABLE";

export const FEE_TYPES: readonly FeeType[] = [
  "FIXED_AMOUNT",
  "INDEXED_AMOUNT",
  "EXTERNAL_OR_VARIABLE",
];

/**
 * How an amount is derived.
 *
 * INDEXED is the important case in Paraguay: many official fees are expressed
 * as a multiple of the daily wage (jornal), so the fee moves when the index
 * moves. The multiplier is an integer count of index units.
 */
export type FeeFormula =
  | Readonly<{ kind: "FIXED"; amount: Money }>
  | Readonly<{ kind: "INDEXED"; multiplier: number; feeIndexId: FeeIndexId }>
  | Readonly<{ kind: "EXTERNAL_VARIABLE"; costCode: ExternalCostCode }>;

export type FeeIndexRevision = Readonly<{
  feeIndexRevisionId: FeeIndexRevisionId;
  feeIndexId: FeeIndexId;
  publicationStatus: PublicationStatus;
  verificationStatus: VerificationStatus;
  validFrom: LocalDate;
  validUntil: LocalDate | null;
  unitAmount: Money;
}>;

/** Why a fee could not be turned into a concrete amount. */
export type FeeUnresolvedReason =
  | "FEE_INDEX_MISSING"
  | "FEE_INDEX_AMBIGUOUS"
  | "FEE_INDEX_UNRESOLVED_VERIFICATION"
  | "EXTERNAL_OR_VARIABLE"
  | "RULE_UNRESOLVED";

export type FeeCalculation = Readonly<{
  forProcedure: RequiredProcedureKey;
  componentCode: FeeComponentCode;
  feeType: FeeType;
  formula: FeeFormula;
  /** `null` whenever the amount is not authoritative - never a guess. */
  calculatedAmount: Money | null;
  unresolvedReason: FeeUnresolvedReason | null;
  support: SupportLevel | null;
  provenance: readonly ProvenanceRef[];
}>;

/**
 * Deterministic cost summary.
 *
 * Amounts in different currencies are never added together; each currency gets
 * its own total, and unknown fees are counted rather than estimated.
 */
export type CostEstimateTotal = Readonly<{
  currency: CurrencyCode;
  amountMinorUnits: number;
}>;

export type CostEstimate = Readonly<{
  confirmedOfficial: readonly CostEstimateTotal[];
  indexedOfficial: readonly CostEstimateTotal[];
  unknownOfficialFeeCount: number;
  externalVariableCostCodes: readonly ExternalCostCode[];
}>;
