import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

export type PositiveInteger = Brand<number, "PositiveInteger">;
export type NonNegativeInteger = Brand<number, "NonNegativeInteger">;

export function makePositiveInteger(value: number): Result<PositiveInteger, PrimitiveError> {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return err(primitiveError("PositiveInteger", `expected safe integer > 0, received ${value}`));
  }
  return ok(unsafeBrand<number, "PositiveInteger">(value));
}

export function makeNonNegativeInteger(value: number): Result<NonNegativeInteger, PrimitiveError> {
  if (!Number.isSafeInteger(value) || value < 0) {
    return err(
      primitiveError("NonNegativeInteger", `expected safe integer >= 0, received ${value}`),
    );
  }
  return ok(unsafeBrand<number, "NonNegativeInteger">(value));
}
