import { describe, expect, it } from "vitest";
import { andAll, fromBoolean, negate, orAny } from "../../src/case-engine/conditions/three-valued";
import { TRUTH_VALUES, type TruthValue } from "../../src/rules/definitions/ast";

/**
 * Complete truth tables. UNKNOWN and UNANSWERED both arrive as INDETERMINATE,
 * and the whole product depends on neither of them ever collapsing to FALSE.
 */
describe("three-valued logic", () => {
  it("NOT", () => {
    expect(negate("TRUE")).toBe("FALSE");
    expect(negate("FALSE")).toBe("TRUE");
    expect(negate("INDETERMINATE")).toBe("INDETERMINATE");
  });

  const expectedAll: Record<string, TruthValue> = {
    "TRUE,TRUE": "TRUE",
    "TRUE,FALSE": "FALSE",
    "TRUE,INDETERMINATE": "INDETERMINATE",
    "FALSE,TRUE": "FALSE",
    "FALSE,FALSE": "FALSE",
    "FALSE,INDETERMINATE": "FALSE",
    "INDETERMINATE,TRUE": "INDETERMINATE",
    "INDETERMINATE,FALSE": "FALSE",
    "INDETERMINATE,INDETERMINATE": "INDETERMINATE",
  };

  const expectedAny: Record<string, TruthValue> = {
    "TRUE,TRUE": "TRUE",
    "TRUE,FALSE": "TRUE",
    "TRUE,INDETERMINATE": "TRUE",
    "FALSE,TRUE": "TRUE",
    "FALSE,FALSE": "FALSE",
    "FALSE,INDETERMINATE": "INDETERMINATE",
    "INDETERMINATE,TRUE": "TRUE",
    "INDETERMINATE,FALSE": "INDETERMINATE",
    "INDETERMINATE,INDETERMINATE": "INDETERMINATE",
  };

  for (const left of TRUTH_VALUES) {
    for (const right of TRUTH_VALUES) {
      const key = `${left},${right}`;
      it(`ALL(${key})`, () => {
        expect(andAll([left, right])).toBe(expectedAll[key]);
      });
      it(`ANY(${key})`, () => {
        expect(orAny([left, right])).toBe(expectedAny[key]);
      });
    }
  }

  it("an empty ALL is vacuously true and an empty ANY vacuously false", () => {
    expect(andAll([])).toBe("TRUE");
    expect(orAny([])).toBe("FALSE");
  });

  it("lifts booleans", () => {
    expect(fromBoolean(true)).toBe("TRUE");
    expect(fromBoolean(false)).toBe("FALSE");
  });
});
