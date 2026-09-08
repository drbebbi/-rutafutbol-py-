import { err, ok, type Result } from "../../shared/result/result";
import type { ExternalCostCode } from "../../domain/identifiers/identifiers";
import type { CurrencyCode } from "../../domain/primitives/money";
import type { CostEstimate, CostEstimateTotal, FeeCalculation } from "../../domain/fees/fee";
import { compareStrings } from "../canonicalization/ordering";
import { ruleEvaluationError, type EngineError } from "../errors/engine-error";

/**
 * Deterministic cost summary.
 *
 * Amounts are grouped by currency and never mixed. Fees whose amount is not
 * authoritative are counted, not estimated: an "approximately" total would be
 * read by users as a number they can budget with.
 */
export function buildCostEstimate(
  feeCalculations: readonly FeeCalculation[],
): Result<CostEstimate, EngineError> {
  const confirmed = new Map<string, number>();
  const indexed = new Map<string, number>();
  const externalCodes = new Set<string>();
  let unknownCount = 0;

  for (const fee of feeCalculations) {
    if (fee.formula.kind === "EXTERNAL_VARIABLE") {
      externalCodes.add(fee.formula.costCode as string);
      continue;
    }
    if (fee.calculatedAmount === null) {
      unknownCount += 1;
      continue;
    }
    const bucket = fee.formula.kind === "INDEXED" ? indexed : confirmed;
    const currency = fee.calculatedAmount.currency as string;
    const running = (bucket.get(currency) ?? 0) + fee.calculatedAmount.amountMinorUnits;
    if (!Number.isSafeInteger(running)) {
      return err(
        ruleEvaluationError("MONEY_OVERFLOW", `cost estimate for ${currency} exceeds the safe integer range`),
      );
    }
    bucket.set(currency, running);
  }

  const toTotals = (bucket: ReadonlyMap<string, number>): readonly CostEstimateTotal[] =>
    [...bucket.entries()]
      .sort((a, b) => compareStrings(a[0], b[0]))
      .map(([currency, amountMinorUnits]) => ({
        currency: currency as CurrencyCode,
        amountMinorUnits,
      }));

  return ok({
    confirmedOfficial: toTotals(confirmed),
    indexedOfficial: toTotals(indexed),
    unknownOfficialFeeCount: unknownCount,
    externalVariableCostCodes: [...externalCodes].sort().map((code) => code as ExternalCostCode),
  });
}
