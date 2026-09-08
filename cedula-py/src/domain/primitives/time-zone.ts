import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/** An IANA time zone identifier, e.g. `America/Asuncion`. */
export type IanaTimeZone = Brand<string, "IanaTimeZone">;

const SHAPE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/u;

export function makeIanaTimeZone(value: string): Result<IanaTimeZone, PrimitiveError> {
  if (!SHAPE_PATTERN.test(value)) {
    return err(primitiveError("IanaTimeZone", `not an IANA zone identifier: "${value}"`));
  }
  try {
    // Resolves against the platform tz database. Node 24 ships full ICU.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    return err(primitiveError("IanaTimeZone", `unknown time zone: "${value}"`));
  }
  return ok(unsafeBrand<string, "IanaTimeZone">(value));
}

/**
 * The jurisdiction whose calendar governs every legal date decision in this
 * product. Never the server time zone (Decision: no legal decision may depend
 * on where the process happens to run).
 */
export const JURISDICTION_TIME_ZONE: IanaTimeZone = unsafeBrand<string, "IanaTimeZone">(
  "America/Asuncion",
);
