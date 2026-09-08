import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/** ISO 3166-1 alpha-2, always upper case. */
export type CountryCode = Brand<string, "CountryCode">;

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;

export function makeCountryCode(value: string): Result<CountryCode, PrimitiveError> {
  if (!COUNTRY_CODE_PATTERN.test(value)) {
    return err(
      primitiveError("CountryCode", `expected ISO 3166-1 alpha-2 upper case, received "${value}"`),
    );
  }
  return ok(unsafeBrand<string, "CountryCode">(value));
}

/**
 * Only used where the value provably comes from a validated source
 * (e.g. a compile-time constant in this module).
 */
function constantCountry(value: string): CountryCode {
  return unsafeBrand<string, "CountryCode">(value);
}

export const PARAGUAY: CountryCode = constantCountry("PY");

/**
 * The Europe MVP country scope (Phase 0). This is a *product* scope constant,
 * not a legal statement: it lists the countries the first release intends to
 * cover, nothing about their requirements.
 */
export const EUROPE_MVP_COUNTRIES: readonly CountryCode[] = [
  "AT",
  "BE",
  "CH",
  "DE",
  "ES",
  "FR",
  "GB",
  "IT",
  "NL",
  "PT",
].map(constantCountry);
