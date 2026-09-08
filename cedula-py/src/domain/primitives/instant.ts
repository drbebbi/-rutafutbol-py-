import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/**
 * An RFC 3339 instant that is always expressed in UTC (`Z`).
 *
 * Local offsets are deliberately rejected: the single place where a wall-clock
 * date is derived is `deriveEffectiveLocalDate`, which takes an explicit
 * jurisdiction time zone. Allowing `+02:00` here would create a second, hidden
 * source of "what day is it".
 */
export type InstantString = Brand<string, "InstantString">;

const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/u;

export function makeInstantString(value: string): Result<InstantString, PrimitiveError> {
  const match = INSTANT_PATTERN.exec(value);
  if (match === null) {
    return err(
      primitiveError("InstantString", `expected RFC 3339 UTC instant ending in "Z", received "${value}"`),
    );
  }
  const epochMillis = Date.parse(value);
  if (Number.isNaN(epochMillis)) {
    return err(primitiveError("InstantString", `not a real instant: "${value}"`));
  }
  // Date.parse accepts out-of-range components such as month 13 in some
  // engines; re-render to confirm the value round-trips.
  const rendered = new Date(epochMillis).toISOString();
  if (rendered.slice(0, 10) !== value.slice(0, 10)) {
    return err(primitiveError("InstantString", `not a real calendar instant: "${value}"`));
  }
  return ok(unsafeBrand<string, "InstantString">(value));
}

export function instantToEpochMillis(instant: InstantString): number {
  return Date.parse(instant as string);
}
