import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  collectResults,
  err,
  flatMapResult,
  isErr,
  isOk,
  mapError,
  mapResult,
  ok,
  unwrapOrThrow,
} from "../../src/shared/result/result";
import {
  canonicalJsonStringify,
  CanonicalJsonError,
} from "../../src/shared/serialization/canonical-json";
import { sha256HexOfUtf8 } from "../../src/shared/hashing/sha256";
import { unbrand, unsafeBrand } from "../../src/shared/ids/brand";

describe("Result", () => {
  it("distinguishes ok from err", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("boom"))).toBe(true);
  });

  it("maps values and errors", () => {
    expect(mapResult(ok(2), (v) => v * 2)).toEqual(ok(4));
    expect(mapResult(err("e"), (v: number) => v)).toEqual(err("e"));
    expect(mapError(err("e"), (e) => `${e}!`)).toEqual(err("e!"));
    expect(mapError(ok(1), (e: string) => e)).toEqual(ok(1));
    expect(flatMapResult(ok(2), (v) => ok(v + 1))).toEqual(ok(3));
    expect(flatMapResult(err("e"), (v: number) => ok(v))).toEqual(err("e"));
  });

  it("collects results, failing on the first error", () => {
    expect(collectResults([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(collectResults([ok(1), err("bad"), err("worse")])).toEqual(err("bad"));
  });

  it("throws only when explicitly unwrapped", () => {
    expect(unwrapOrThrow(ok(5))).toBe(5);
    expect(() => unwrapOrThrow(err("x"))).toThrow();
  });
});

describe("brands", () => {
  it("round-trips through unbrand", () => {
    const branded = unsafeBrand<string, "Test">("value");
    expect(unbrand(branded)).toBe("value");
  });
});

describe("canonical JSON", () => {
  it("is independent of object key order", () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe(canonicalJsonStringify({ a: 2, b: 1 }));
  });

  it("preserves array order, because arrays are ordered data", () => {
    expect(canonicalJsonStringify([1, 2])).not.toBe(canonicalJsonStringify([2, 1]));
  });

  it("normalises negative zero", () => {
    expect(canonicalJsonStringify(-0)).toBe("0");
  });

  it("rejects undefined rather than silently dropping it", () => {
    expect(() => canonicalJsonStringify({ a: undefined })).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonStringify(undefined)).toThrow(CanonicalJsonError);
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJsonStringify(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonStringify(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonStringify(1n)).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonStringify(() => 1)).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonStringify(Symbol("s"))).toThrow(CanonicalJsonError);
  });

  it("handles nested structures and primitives", () => {
    expect(canonicalJsonStringify({ z: [true, false, null, "s"], a: { n: 1 } })).toBe(
      '{"a":{"n":1},"z":[true,false,null,"s"]}',
    );
  });
});

describe("sha256", () => {
  const samples = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "cédula-py ñ"];

  it.each(samples)("agrees with node:crypto for %j", (input) => {
    expect(sha256HexOfUtf8(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
  });
});
