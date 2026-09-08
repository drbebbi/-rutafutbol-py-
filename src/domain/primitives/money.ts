import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/** ISO 4217 alphabetic currency code, upper case. */
export type CurrencyCode = Brand<string, "CurrencyCode">;

const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

export function makeCurrencyCode(value: string): Result<CurrencyCode, PrimitiveError> {
  if (!CURRENCY_PATTERN.test(value)) {
    return err(primitiveError("CurrencyCode", `expected ISO 4217 alpha-3, received "${value}"`));
  }
  return ok(unsafeBrand<string, "CurrencyCode">(value));
}

export function currencyCodeConstant(value: string): CurrencyCode {
  return unsafeBrand<string, "CurrencyCode">(value);
}

/** Paraguayan guarani has zero minor units; amounts are whole guaranies. */
export const PYG: CurrencyCode = currencyCodeConstant("PYG");

/**
 * Money is always integer minor units plus a currency.
 *
 * Floating point money is forbidden: a fee of 2 926 925 Gs must never become
 * 2926924.9999999995 because an index multiplication went through a double.
 */
export type Money = Readonly<{
  amountMinorUnits: number;
  currency: CurrencyCode;
}>;

export function makeMoney(
  amountMinorUnits: number,
  currency: CurrencyCode,
): Result<Money, PrimitiveError> {
  if (!Number.isSafeInteger(amountMinorUnits)) {
    return err(
      primitiveError("Money", `amount must be a safe integer, received ${amountMinorUnits}`),
    );
  }
  if (amountMinorUnits < 0) {
    return err(primitiveError("Money", `amount must not be negative, received ${amountMinorUnits}`));
  }
  return ok({ amountMinorUnits, currency });
}

export type MoneyOverflow = Readonly<{ kind: "MONEY_OVERFLOW"; message: string }>;

/**
 * Multiplies money by a positive integer multiplier, refusing to produce a
 * value outside the safe-integer range (Decision: overflow is an engine error,
 * never a silently wrong amount).
 */
export function multiplyMoney(
  money: Money,
  multiplier: number,
): Result<Money, MoneyOverflow> {
  if (!Number.isSafeInteger(multiplier) || multiplier < 0) {
    return err({
      kind: "MONEY_OVERFLOW",
      message: `multiplier must be a non-negative safe integer, received ${multiplier}`,
    });
  }
  const product = money.amountMinorUnits * multiplier;
  if (!Number.isSafeInteger(product)) {
    return err({
      kind: "MONEY_OVERFLOW",
      message: `${money.amountMinorUnits} * ${multiplier} exceeds Number.MAX_SAFE_INTEGER`,
    });
  }
  return ok({ amountMinorUnits: product, currency: money.currency });
}

export function addMoney(left: Money, right: Money): Result<Money, MoneyOverflow> {
  if (left.currency !== right.currency) {
    return err({
      kind: "MONEY_OVERFLOW",
      message: `refusing to add ${left.currency} to ${right.currency}`,
    });
  }
  const sum = left.amountMinorUnits + right.amountMinorUnits;
  if (!Number.isSafeInteger(sum)) {
    return err({ kind: "MONEY_OVERFLOW", message: "sum exceeds Number.MAX_SAFE_INTEGER" });
  }
  return ok({ amountMinorUnits: sum, currency: left.currency });
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amountMinorUnits === right.amountMinorUnits;
}

export function unsafeMoney(amountMinorUnits: number, currency: CurrencyCode): Money {
  return { amountMinorUnits, currency };
}
