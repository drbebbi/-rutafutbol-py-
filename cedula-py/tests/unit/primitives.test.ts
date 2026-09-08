import { describe, expect, it } from "vitest";
import { makeCountryCode, EUROPE_MVP_COUNTRIES } from "../../src/domain/primitives/country";
import { makeLanguageCode } from "../../src/domain/primitives/language";
import { makeInstantString } from "../../src/domain/primitives/instant";
import { makeLocalDate, daysInMonth } from "../../src/domain/primitives/local-date";
import { makeIanaTimeZone, JURISDICTION_TIME_ZONE } from "../../src/domain/primitives/time-zone";
import { makeRevisionNumber, makeSchemaVersion, makeEngineVersion, makeDerivedKeyFormatVersion } from "../../src/domain/primitives/versioning";
import { makeSha256Hex } from "../../src/domain/primitives/hash";
import {
  addMoney,
  makeCurrencyCode,
  makeMoney,
  moneyEquals,
  multiplyMoney,
  PYG,
} from "../../src/domain/primitives/money";
import { makeNonNegativeInteger, makePositiveInteger } from "../../src/domain/primitives/numbers";
import { unwrapOrThrow } from "../../src/shared/result/result";

describe("CountryCode", () => {
  it("accepts ISO 3166-1 alpha-2 upper case", () => {
    expect(makeCountryCode("DE").ok).toBe(true);
  });

  it.each(["de", "DEU", "D", "", "D1"])("rejects %s", (value) => {
    expect(makeCountryCode(value).ok).toBe(false);
  });

  it("declares the Europe MVP scope in canonical order", () => {
    expect(EUROPE_MVP_COUNTRIES.map(String)).toEqual([
      "AT", "BE", "CH", "DE", "ES", "FR", "GB", "IT", "NL", "PT",
    ]);
  });
});

describe("LanguageCode", () => {
  it("accepts lower-case ISO 639-1", () => {
    expect(makeLanguageCode("es").ok).toBe(true);
  });
  it.each(["ES", "spa", "e"])("rejects %s", (value) => {
    expect(makeLanguageCode(value).ok).toBe(false);
  });
});

describe("InstantString", () => {
  it("accepts a UTC instant", () => {
    expect(makeInstantString("2026-06-15T12:00:00Z").ok).toBe(true);
    expect(makeInstantString("2026-06-15T12:00:00.123Z").ok).toBe(true);
  });

  it("rejects a local offset, because that would be a second source of 'what day is it'", () => {
    expect(makeInstantString("2026-06-15T12:00:00+02:00").ok).toBe(false);
  });

  it.each(["2026-06-15", "2026-13-15T12:00:00Z", "not-a-date"])("rejects %s", (value) => {
    expect(makeInstantString(value).ok).toBe(false);
  });
});

describe("LocalDate", () => {
  it("accepts real calendar dates", () => {
    expect(makeLocalDate("2024-02-29").ok).toBe(true);
  });
  it.each(["2025-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-1-1", "20260101"])(
    "rejects %s",
    (value) => {
      expect(makeLocalDate(value).ok).toBe(false);
    },
  );
  it("knows leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });
});

describe("IanaTimeZone", () => {
  it("accepts America/Asuncion and uses it as the jurisdiction default", () => {
    expect(makeIanaTimeZone("America/Asuncion").ok).toBe(true);
    expect(String(JURISDICTION_TIME_ZONE)).toBe("America/Asuncion");
  });
  it.each(["UTC", "Nowhere/Nothing", "america"])("rejects %s", (value) => {
    expect(makeIanaTimeZone(value).ok).toBe(false);
  });
});

describe("versioning", () => {
  it("validates revision numbers", () => {
    expect(makeRevisionNumber(1).ok).toBe(true);
    expect(makeRevisionNumber(0).ok).toBe(false);
    expect(makeRevisionNumber(1.5).ok).toBe(false);
  });
  it("validates schema versions", () => {
    expect(makeSchemaVersion("rule-payload@1.0").ok).toBe(true);
    expect(makeSchemaVersion("RulePayload@1.0").ok).toBe(false);
    expect(makeSchemaVersion("rule-payload").ok).toBe(false);
  });
  it("validates engine and derived key versions", () => {
    expect(makeEngineVersion("1.0.0").ok).toBe(true);
    expect(makeEngineVersion("1.0").ok).toBe(false);
    expect(makeDerivedKeyFormatVersion("1").ok).toBe(true);
    expect(makeDerivedKeyFormatVersion("v1").ok).toBe(false);
  });
});

describe("Sha256Hex", () => {
  it("requires 64 lower-case hex characters", () => {
    expect(makeSha256Hex("a".repeat(64)).ok).toBe(true);
    expect(makeSha256Hex("A".repeat(64)).ok).toBe(false);
    expect(makeSha256Hex("a".repeat(63)).ok).toBe(false);
  });
});

describe("Money", () => {
  it("is integer minor units plus a currency", () => {
    const money = makeMoney(2926925, PYG);
    expect(money.ok).toBe(true);
    expect(makeMoney(1.5, PYG).ok).toBe(false);
    expect(makeMoney(-1, PYG).ok).toBe(false);
  });

  it("validates currency codes", () => {
    expect(makeCurrencyCode("PYG").ok).toBe(true);
    expect(makeCurrencyCode("pyg").ok).toBe(false);
  });

  it("multiplies without leaving the safe integer range", () => {
    const unit = { amountMinorUnits: 117077, currency: PYG };
    const result = multiplyMoney(unit, 25);
    expect(result.ok && result.value.amountMinorUnits).toBe(2926925);
  });

  it("refuses to overflow rather than returning a wrong amount", () => {
    const unit = { amountMinorUnits: Number.MAX_SAFE_INTEGER, currency: PYG };
    const result = multiplyMoney(unit, 2);
    expect(result.ok).toBe(false);
  });

  it("adds within one currency and refuses to mix currencies", () => {
    const eur = unwrapOrThrow(makeCurrencyCode("EUR"));
    const sum = addMoney({ amountMinorUnits: 100, currency: PYG }, { amountMinorUnits: 23, currency: PYG });
    expect(sum.ok && sum.value.amountMinorUnits).toBe(123);
    expect(addMoney({ amountMinorUnits: 100, currency: PYG }, { amountMinorUnits: 1, currency: eur }).ok).toBe(false);
    expect(
      addMoney(
        { amountMinorUnits: Number.MAX_SAFE_INTEGER, currency: PYG },
        { amountMinorUnits: 1, currency: PYG },
      ).ok,
    ).toBe(false);
  });

  it("compares by amount and currency", () => {
    expect(moneyEquals({ amountMinorUnits: 1, currency: PYG }, { amountMinorUnits: 1, currency: PYG })).toBe(true);
    expect(moneyEquals({ amountMinorUnits: 1, currency: PYG }, { amountMinorUnits: 2, currency: PYG })).toBe(false);
  });
});

describe("integers", () => {
  it("validates positive and non-negative integers", () => {
    expect(makePositiveInteger(1).ok).toBe(true);
    expect(makePositiveInteger(0).ok).toBe(false);
    expect(makeNonNegativeInteger(0).ok).toBe(true);
    expect(makeNonNegativeInteger(-1).ok).toBe(false);
  });
});
