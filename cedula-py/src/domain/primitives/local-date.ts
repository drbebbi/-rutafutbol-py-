import type { Brand } from "../../shared/ids/brand";
import { unsafeBrand } from "../../shared/ids/brand";
import { err, ok, type Result } from "../../shared/result/result";
import { primitiveError, type PrimitiveError } from "./errors";

/**
 * A calendar date without time or zone, `YYYY-MM-DD`.
 *
 * Legal deadlines in this product are calendar based, never millisecond based,
 * so `LocalDate` - not `Date` - is the unit the engine reasons in.
 */
export type LocalDate = Brand<string, "LocalDate">;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export type CalendarParts = Readonly<{ year: number; month: number; day: number }>;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function makeLocalDate(value: string): Result<LocalDate, PrimitiveError> {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    return err(primitiveError("LocalDate", `expected YYYY-MM-DD, received "${value}"`));
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return err(primitiveError("LocalDate", `month out of range in "${value}"`));
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return err(primitiveError("LocalDate", `day out of range in "${value}"`));
  }
  return ok(unsafeBrand<string, "LocalDate">(value));
}

export function localDateParts(date: LocalDate): CalendarParts {
  const raw = date as string;
  return {
    year: Number(raw.slice(0, 4)),
    month: Number(raw.slice(5, 7)),
    day: Number(raw.slice(8, 10)),
  };
}

export function localDateFromParts(parts: CalendarParts): LocalDate {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return unsafeBrand<string, "LocalDate">(`${year}-${month}-${day}`);
}
