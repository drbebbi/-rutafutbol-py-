import { describe, it, expect } from "vitest";
import {
  simpleEV, probabilityEdge, computeValueSignal, asianHandicapEV,
  confidenceScore, confidenceLabel, recommendationStatus, qualityAdjustedEV,
  passesFilter, VALUE_PROFILES,
} from "../valueEngine.js";

describe("simpleEV", () => {
  it("computes (prob * odds) - 1", () => {
    expect(simpleEV(0.6, 2)).toBeCloseTo(0.2);
    expect(simpleEV(0.5, 2)).toBeCloseTo(0);
    expect(simpleEV(0.4, 2)).toBeCloseTo(-0.2);
  });
  it("returns null for invalid input", () => {
    expect(simpleEV(0.5, 0)).toBeNull();
    expect(simpleEV(NaN, 2)).toBeNull();
  });
});

describe("probabilityEdge", () => {
  it("computes model - noVig", () => {
    expect(probabilityEdge(0.6, 0.5)).toBeCloseTo(0.1);
  });
});

describe("computeValueSignal", () => {
  it("computes ev, edge, fair odds", () => {
    const sig = computeValueSignal({ modelProbability: 0.6, apostaOdds: 2, selection: "home", marketOdds: { home: 2, away: 3, draw: 3.5 }, requiredSelections: ["home", "draw", "away"] });
    expect(sig.expectedValue).toBeCloseTo(0.2);
    expect(sig.fairOdds).toBeCloseTo(1 / 0.6, 4);
    expect(sig.rawImpliedProbability).toBeCloseTo(0.5);
  });
});

describe("asianHandicapEV", () => {
  it("sums probability * payout", () => {
    const ev = asianHandicapEV([
      { probability: 0.5, payoutMultiplier: 1 },
      { probability: 0.5, payoutMultiplier: -1 },
    ]);
    expect(ev).toBeCloseTo(0);
  });
});

describe("confidenceScore", () => {
  it("returns a value in [0,1]", () => {
    const s = confidenceScore({
      modelAgreement: 0.8, calibrationQuality: 0.7, featureCompleteness: 0.9,
      oddsFreshness: 1, mappingConfidence: 0.9, lineupStatus: 0.8,
      sampleSize: 0.8, modelUncertainty: 0.6,
    });
    expect(s).toBeGreaterThan(0.7);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("confidenceLabel", () => {
  it("maps score to label", () => {
    expect(confidenceLabel(0.8)).toBe("high");
    expect(confidenceLabel(0.5)).toBe("medium");
    expect(confidenceLabel(0.2)).toBe("low");
  });
});

describe("recommendationStatus", () => {
  it("returns market_suspended when market closed", () => {
    expect(recommendationStatus({ ev: 0.1, marketOpen: false })).toBe("market_suspended");
  });
  it("returns stale when odds not fresh", () => {
    expect(recommendationStatus({ ev: 0.1, oddsFresh: false, marketOpen: true })).toBe("stale");
  });
  it("returns insufficient_data when mapping not confident", () => {
    expect(recommendationStatus({ ev: 0.1, oddsFresh: true, mappingConfident: false, marketOpen: true })).toBe("insufficient_data");
  });
  it("returns strong_value for high EV", () => {
    expect(recommendationStatus({ ev: 0.1, oddsFresh: true, mappingConfident: true, sampleMet: true, dataQuality: "full", marketOpen: true })).toBe("strong_value");
  });
  it("returns value for moderate EV", () => {
    expect(recommendationStatus({ ev: 0.05, oddsFresh: true, mappingConfident: true, sampleMet: true, dataQuality: "partial", marketOpen: true })).toBe("value");
  });
  it("returns watch for small positive EV", () => {
    expect(recommendationStatus({ ev: 0.01, oddsFresh: true, mappingConfident: true, sampleMet: true, dataQuality: "partial", marketOpen: true })).toBe("watch");
  });
  it("returns no_value for negative EV", () => {
    expect(recommendationStatus({ ev: -0.05, oddsFresh: true, mappingConfident: true, sampleMet: true, dataQuality: "partial", marketOpen: true })).toBe("no_value");
  });
});

describe("qualityAdjustedEV", () => {
  it("scales EV by confidence", () => {
    expect(qualityAdjustedEV(0.1, 1)).toBeCloseTo(0.1);
    expect(qualityAdjustedEV(0.1, 0.5)).toBeCloseTo(0.075);
  });
});

describe("passesFilter", () => {
  it("respects the conservative profile", () => {
    const sig = { expectedValue: 0.04, mappingConfidence: 0.9, confidence: "high" };
    expect(passesFilter(sig, "conservative")).toBe(false);
    expect(passesFilter({ ...sig, expectedValue: 0.06 }, "conservative")).toBe(true);
  });
  it("respects the aggressive profile", () => {
    const sig = { expectedValue: 0.02, mappingConfidence: 0.7, confidence: "medium" };
    expect(passesFilter(sig, "aggressive")).toBe(true);
  });
});

describe("VALUE_PROFILES", () => {
  it("defines thresholds for all profiles", () => {
    expect(VALUE_PROFILES.conservative.minEV).toBeGreaterThan(VALUE_PROFILES.balanced.minEV);
    expect(VALUE_PROFILES.balanced.minEV).toBeGreaterThan(VALUE_PROFILES.aggressive.minEV);
  });
});