import { describe, expect, it } from "vitest";
import {
  addCalendarPeriod,
  addDays,
  compareLocalDates,
  coversAtLeastCalendarPeriod,
  deriveEffectiveLocalDate,
  fromEpochDay,
  intersectIntervals,
  parseLocalDate,
  toEpochDay,
  toHalfOpenInterval,
} from "../../src/case-engine/date-math/calendar";
import { createEvaluationExecutionContext } from "../../src/case-engine/date-math/execution-context";
import { JURISDICTION_TIME_ZONE, makeIanaTimeZone } from "../../src/domain/primitives/time-zone";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import type { InstantString } from "../../src/domain/primitives/instant";
import { unwrapOrThrow } from "../../src/shared/result/result";

const d = (value: string): LocalDate => value as LocalDate;
const period = (years: number, months: number, days: number) => ({ years, months, days });

describe("calendar overflow uses CONSTRAIN", () => {
  const goldens: readonly (readonly [string, ReturnType<typeof period>, "PLUS" | "MINUS", string])[] = [
    ["2024-02-29", period(1, 0, 0), "PLUS", "2025-02-28"],
    ["2026-01-31", period(0, 1, 0), "PLUS", "2026-02-28"],
    ["2026-03-31", period(0, 1, 0), "MINUS", "2026-02-28"],
    ["2024-01-31", period(0, 1, 0), "PLUS", "2024-02-29"],
    ["2026-01-31", period(0, 3, 0), "PLUS", "2026-04-30"],
    ["2026-12-31", period(0, 1, 0), "PLUS", "2027-01-31"],
    ["2026-01-01", period(0, 0, 1), "MINUS", "2025-12-31"],
    ["2026-12-31", period(0, 0, 1), "PLUS", "2027-01-01"],
    ["2024-02-29", period(4, 0, 0), "PLUS", "2028-02-29"],
    ["2026-06-15", period(0, 0, 0), "PLUS", "2026-06-15"],
    ["2026-05-31", period(1, 1, 1), "PLUS", "2027-07-01"],
  ];

  it.each(goldens)("%s %o %s -> %s", (start, shift, direction, expected) => {
    const result = addCalendarPeriod(d(start), shift, direction);
    expect(result.ok && (result.value as string)).toBe(expected);
  });

  it("rejects a malformed period rather than guessing", () => {
    expect(addCalendarPeriod(d("2026-01-01"), period(-1, 0, 0), "PLUS").ok).toBe(false);
    expect(addCalendarPeriod(d("2026-01-01"), { years: 0, months: 0.5, days: 0 }, "PLUS").ok).toBe(false);
  });
});

describe("epoch day round trip", () => {
  it.each(["1970-01-01", "1969-12-31", "2000-02-29", "2026-06-15", "2100-03-01"])("%s", (value) => {
    expect(fromEpochDay(toEpochDay(d(value))) as string).toBe(value);
  });

  it("orders dates", () => {
    expect(compareLocalDates(d("2026-01-01"), d("2026-01-02"))).toBe(-1);
    expect(compareLocalDates(d("2026-01-02"), d("2026-01-01"))).toBe(1);
    expect(compareLocalDates(d("2026-01-01"), d("2026-01-01"))).toBe(0);
    expect(addDays(d("2026-02-28"), 1) as string).toBe("2026-03-01");
  });

  it("parses and rejects", () => {
    expect(parseLocalDate("2026-06-15").ok).toBe(true);
    expect(parseLocalDate("2026-06-31").ok).toBe(false);
  });
});

describe("half-open intervals", () => {
  it("converts an inclusive user range into [start, end)", () => {
    const interval = unwrapOrThrow(toHalfOpenInterval(d("2024-01-01"), d("2024-12-31"), d("2026-06-15")));
    expect(interval.startInclusive as string).toBe("2024-01-01");
    expect(interval.endExclusive as string).toBe("2025-01-01");
  });

  it("ends an ongoing stay on the effective date inclusive", () => {
    const interval = unwrapOrThrow(toHalfOpenInterval(d("2024-01-01"), null, d("2026-06-15")));
    expect(interval.endExclusive as string).toBe("2026-06-16");
  });

  it("rejects an inverted interval", () => {
    expect(toHalfOpenInterval(d("2026-01-02"), d("2026-01-01"), d("2026-06-15")).ok).toBe(false);
  });

  it("intersects intervals and reports no overlap as null", () => {
    const a = unwrapOrThrow(toHalfOpenInterval(d("2024-01-01"), d("2024-12-31"), d("2026-06-15")));
    const b = unwrapOrThrow(toHalfOpenInterval(d("2024-07-01"), d("2025-06-30"), d("2026-06-15")));
    const c = unwrapOrThrow(toHalfOpenInterval(d("2025-07-01"), d("2025-12-31"), d("2026-06-15")));
    const overlap = intersectIntervals(a, b);
    expect(overlap?.startInclusive as string).toBe("2024-07-01");
    expect(overlap?.endExclusive as string).toBe("2025-01-01");
    expect(intersectIntervals(a, c)).toBeNull();
    expect(intersectIntervals(b, a)?.startInclusive as string).toBe("2024-07-01");
  });

  it("measures coverage calendrically, not in days", () => {
    // A year starting 2024-02-29 ends, under CONSTRAIN, on 2025-02-27
    // inclusive - exactly as a year starting 2024-01-01 ends on 2024-12-31.
    const exactYear = unwrapOrThrow(toHalfOpenInterval(d("2024-02-29"), d("2025-02-27"), d("2026-06-15")));
    expect(unwrapOrThrow(coversAtLeastCalendarPeriod(exactYear, period(1, 0, 0)))).toBe(true);
    const oneDayShort = unwrapOrThrow(toHalfOpenInterval(d("2024-02-29"), d("2025-02-26"), d("2026-06-15")));
    expect(unwrapOrThrow(coversAtLeastCalendarPeriod(oneDayShort, period(1, 0, 0)))).toBe(false);
    expect(unwrapOrThrow(coversAtLeastCalendarPeriod(oneDayShort, period(0, 11, 0)))).toBe(true);
    const full = unwrapOrThrow(toHalfOpenInterval(d("2024-01-01"), d("2024-12-31"), d("2026-06-15")));
    expect(unwrapOrThrow(coversAtLeastCalendarPeriod(full, period(1, 0, 0)))).toBe(true);
    expect(unwrapOrThrow(coversAtLeastCalendarPeriod(full, period(1, 0, 1)))).toBe(false);
  });
});

describe("effective local date", () => {
  it("uses the jurisdiction time zone, not the server's", () => {
    // Asuncion runs on a fixed -03:00 offset in the platform tz database, so
    // 02:30 UTC on 16 June is still 23:30 on 15 June locally.
    const result = deriveEffectiveLocalDate(
      "2026-06-16T02:30:00Z" as InstantString,
      JURISDICTION_TIME_ZONE,
    );
    expect(result.ok && (result.value as string)).toBe("2026-06-15");
  });

  it("crosses local midnight exactly once", () => {
    const before = deriveEffectiveLocalDate("2026-06-16T02:59:59Z" as InstantString, JURISDICTION_TIME_ZONE);
    const after = deriveEffectiveLocalDate("2026-06-16T03:00:00Z" as InstantString, JURISDICTION_TIME_ZONE);
    expect(before.ok && (before.value as string)).toBe("2026-06-15");
    expect(after.ok && (after.value as string)).toBe("2026-06-16");
  });

  it("differs from a European zone for the same instant", () => {
    const berlin = unwrapOrThrow(makeIanaTimeZone("Europe/Berlin"));
    const asuncion = deriveEffectiveLocalDate("2026-06-15T23:00:00Z" as InstantString, JURISDICTION_TIME_ZONE);
    const german = deriveEffectiveLocalDate("2026-06-15T23:00:00Z" as InstantString, berlin);
    expect(asuncion.ok && (asuncion.value as string)).toBe("2026-06-15");
    expect(german.ok && (german.value as string)).toBe("2026-06-16");
  });

  it("rejects an unparseable instant or unknown zone", () => {
    expect(deriveEffectiveLocalDate("nope" as InstantString, JURISDICTION_TIME_ZONE).ok).toBe(false);
    expect(
      deriveEffectiveLocalDate("2026-06-15T00:00:00Z" as InstantString, "Nowhere/Nothing" as never).ok,
    ).toBe(false);
  });
});

describe("evaluation execution context", () => {
  it("derives the effective local date exactly once", () => {
    const context = unwrapOrThrow(
      createEvaluationExecutionContext({
        evaluatedAt: "2026-06-16T02:30:00Z" as InstantString,
        jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
      }),
    );
    expect(context.effectiveLocalDate as string).toBe("2026-06-15");
    expect(context.evaluation.evaluatedAt as string).toBe("2026-06-16T02:30:00Z");
  });

  it("fails rather than defaulting when the context is unusable", () => {
    expect(
      createEvaluationExecutionContext({
        evaluatedAt: "nope" as InstantString,
        jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
      }).ok,
    ).toBe(false);
  });
});
