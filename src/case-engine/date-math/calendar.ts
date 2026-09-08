import { err, ok, type Result } from "../../shared/result/result";
import {
  daysInMonth,
  localDateFromParts,
  localDateParts,
  makeLocalDate,
  type LocalDate,
} from "../../domain/primitives/local-date";
import type { InstantString } from "../../domain/primitives/instant";
import type { IanaTimeZone } from "../../domain/primitives/time-zone";
import type { CalendarPeriod } from "../../rules/definitions/ast";
import { ruleEvaluationError, type EngineError } from "../errors/engine-error";

/**
 * Pure calendar arithmetic.
 *
 * Everything here works on plain dates. No `Date` object escapes this module
 * except inside `deriveEffectiveLocalDate`, which is the single, explicit
 * bridge from an instant to a jurisdiction-local calendar day.
 */

/** Days from 1970-01-01 (Howard Hinnant's civil-from-days, inverted). */
export function toEpochDay(date: LocalDate): number {
  const { year, month, day } = localDateParts(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromEpochDay(epochDay: number): LocalDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return localDateFromParts({ year: month <= 2 ? y + 1 : y, month, day });
}

export function compareLocalDates(left: LocalDate, right: LocalDate): -1 | 0 | 1 {
  const a = left as string;
  const b = right as string;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function parseLocalDate(value: string): Result<LocalDate, EngineError> {
  const parsed = makeLocalDate(value);
  return parsed.ok
    ? ok(parsed.value)
    : err(ruleEvaluationError("INVALID_DATE_EXPRESSION", parsed.error.message));
}

/**
 * Adds (or subtracts) a calendar period using CONSTRAIN overflow semantics.
 *
 *   2026-01-31 + 1 month -> 2026-02-28
 *   2024-02-29 + 1 year  -> 2025-02-28
 *   2026-03-31 - 1 month -> 2026-02-28
 *
 * The alternative (rolling over into the next month) would silently move a
 * legal deadline past the month a human would name, which is exactly the class
 * of bug this product cannot afford.
 */
export function addCalendarPeriod(
  date: LocalDate,
  period: CalendarPeriod,
  direction: "PLUS" | "MINUS",
): Result<LocalDate, EngineError> {
  if (
    !Number.isSafeInteger(period.years) ||
    !Number.isSafeInteger(period.months) ||
    !Number.isSafeInteger(period.days) ||
    period.years < 0 ||
    period.months < 0 ||
    period.days < 0
  ) {
    return err(
      ruleEvaluationError(
        "INVALID_CALENDAR_PERIOD",
        `calendar period components must be non-negative integers: ${JSON.stringify(period)}`,
      ),
    );
  }

  const sign = direction === "PLUS" ? 1 : -1;
  const parts = localDateParts(date);

  const totalMonths = parts.year * 12 + (parts.month - 1) + sign * (period.years * 12 + period.months);
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12 + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));

  const shifted = localDateFromParts({ year, month, day });
  return ok(addDays(shifted, sign * period.days));
}

/* -------------------------------------------------------------------------- */
/* Intervals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Internally every interval is half-open: `[startInclusive, endExclusive)`.
 *
 * User-facing residence dates are inclusive on both ends, and an ongoing stay
 * ends - for evaluation purposes - on the effective local date inclusive,
 * i.e. `effectiveLocalDate + 1 day` exclusive.
 */
export type HalfOpenInterval = Readonly<{
  startInclusive: LocalDate;
  endExclusive: LocalDate;
}>;

export function toHalfOpenInterval(
  fromInclusive: LocalDate,
  toInclusiveOrOngoing: LocalDate | null,
  effectiveLocalDate: LocalDate,
): Result<HalfOpenInterval, EngineError> {
  const endInclusive = toInclusiveOrOngoing ?? effectiveLocalDate;
  if (compareLocalDates(endInclusive, fromInclusive) < 0) {
    return err(
      ruleEvaluationError(
        "INVALID_INTERVAL",
        `interval end ${endInclusive} precedes start ${fromInclusive}`,
      ),
    );
  }
  return ok({ startInclusive: fromInclusive, endExclusive: addDays(endInclusive, 1) });
}

export function intersectIntervals(
  left: HalfOpenInterval,
  right: HalfOpenInterval,
): HalfOpenInterval | null {
  const start = compareLocalDates(left.startInclusive, right.startInclusive) >= 0
    ? left.startInclusive
    : right.startInclusive;
  const end = compareLocalDates(left.endExclusive, right.endExclusive) <= 0
    ? left.endExclusive
    : right.endExclusive;
  if (compareLocalDates(start, end) >= 0) {
    return null;
  }
  return { startInclusive: start, endExclusive: end };
}

/**
 * True when the interval spans at least the given calendar period.
 *
 * Measured calendrically: "one year" from 2024-02-29 ends 2025-02-28, not
 * "365 days later".
 */
export function coversAtLeastCalendarPeriod(
  interval: HalfOpenInterval,
  period: CalendarPeriod,
): Result<boolean, EngineError> {
  const required = addCalendarPeriod(interval.startInclusive, period, "PLUS");
  if (!required.ok) {
    return required;
  }
  return ok(compareLocalDates(required.value, interval.endExclusive) <= 0);
}

/* -------------------------------------------------------------------------- */
/* Instant -> jurisdiction calendar day                                        */
/* -------------------------------------------------------------------------- */

/**
 * The single place where "what day is it" is answered.
 *
 * Uses the platform tz database through `Intl`, never the server's local time
 * zone: a deployment in Frankfurt and one in Virginia must agree on what day
 * it is in Asuncion.
 */
export function deriveEffectiveLocalDate(
  evaluatedAt: InstantString,
  jurisdictionTimeZone: IanaTimeZone,
): Result<LocalDate, EngineError> {
  const epochMillis = Date.parse(evaluatedAt as string);
  if (Number.isNaN(epochMillis)) {
    return err(
      ruleEvaluationError("INVALID_DATE_EXPRESSION", `not a parseable instant: ${evaluatedAt}`),
    );
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: jurisdictionTimeZone as string,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(epochMillis));
  } catch {
    return err(
      ruleEvaluationError(
        "INVALID_DATE_EXPRESSION",
        `unknown time zone: ${jurisdictionTimeZone}`,
      ),
    );
  }
  const find = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = find("year").padStart(4, "0");
  const month = find("month").padStart(2, "0");
  const day = find("day").padStart(2, "0");
  return parseLocalDate(`${year}-${month}-${day}`);
}
