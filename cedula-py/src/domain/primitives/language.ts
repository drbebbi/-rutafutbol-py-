import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/** ISO 639-1, always lower case. */
export type LanguageCode = Brand<string, "LanguageCode">;

const LANGUAGE_CODE_PATTERN = /^[a-z]{2}$/u;

export function makeLanguageCode(value: string): Result<LanguageCode, PrimitiveError> {
  if (!LANGUAGE_CODE_PATTERN.test(value)) {
    return err(
      primitiveError("LanguageCode", `expected ISO 639-1 lower case, received "${value}"`),
    );
  }
  return ok(unsafeBrand<string, "LanguageCode">(value));
}
