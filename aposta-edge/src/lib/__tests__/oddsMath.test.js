import { describe, it, expect } from "vitest";
import {
  impliedProbability, overround, margin, noVigNormalize, fairOdds,
  decimalToAmerican, clampProbability, describeMovement,
} from "../oddsMath.js";

describe("impliedProbability", () => {
  it("returns 1/odds", () => {
    expect(impliedProbability(2)).toBeCloseTo(0.5);
    expect(impliedProbability(4)).toBeCloseTo(0.25);
  });
  it("returns null for invalid odds", () => {
    expect(impliedProbability(0)).toBeNull();
    expect(impliedProbability(-1)).toBeNull();
    expect(impliedProbability(NaN)).toBeNull();
  });
});

describe("overround & margin", () => {
  it("sums raw implied probabilities", () => {
    expect(overround([0.5, 0.5])).toBeCloseTo(1);
    expect(overround([0.5, 0.5, 0.5])).toBeCloseTo(1.5);
  });
  it("margin = overround - 1", () => {
    expect(margin([0.5, 0.5])).toBeCloseTo(0);
    expect(margin([0.55, 0.55])).toBeCloseTo(0.1);
  });
});

describe("noVigNormalize", () => {
  it("removes the bookmaker margin", () => {
    const norm = noVigNormalize([0.55, 0.55]);
    expect(norm[0]).toBeCloseTo(0.5);
    expect(norm[1]).toBeCloseTo(0.5);
  });
  it("sums to 1", () => {
    const norm = noVigNormalize([0.4, 0.35, 0.3]);
    const sum = norm.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe("fairOdds", () => {
  it("inverts a probability", () => {
    expect(fairOdds(0.5)).toBeCloseTo(2);
    expect(fairOdds(0.25)).toBeCloseTo(4);
  });
});

describe("decimalToAmerican", () => {
  it("converts >= 2 to positive american", () => {
    expect(decimalToAmerican(2)).toBe(100);
    expect(decimalToAmerican(3)).toBe(200);
  });
  it("converts < 2 to negative american", () => {
    expect(decimalToAmerican(1.5)).toBe(-200);
  });
});

describe("clampProbability", () => {
  it("clamps to [0,1]", () => {
    expect(clampProbability(1.5)).toBe(1);
    expect(clampProbability(-0.5)).toBe(0);
    expect(clampProbability(0.5)).toBe(0.5);
    expect(clampProbability(NaN)).toBe(0);
  });
});

describe("describeMovement", () => {
  it("detects shortening", () => {
    expect(describeMovement(2.0, 1.8).direction).toBe("shortened");
  });
  it("detects drifting", () => {
    expect(describeMovement(2.0, 2.2).direction).toBe("drifted");
  });
  it("detects stable", () => {
    expect(describeMovement(2.0, 2.0).direction).toBe("stable");
  });
});