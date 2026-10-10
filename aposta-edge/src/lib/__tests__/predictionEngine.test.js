import { describe, it, expect } from "vitest";
import {
  poissonPmf, scoreMatrix, derive1x2, deriveOverUnder, deriveBTTS,
  deriveCorrectScore, eloExpected, eloUpdate, ensembleLambdas,
  sigmoidCalibrate, predictMatch, validateDistribution,
} from "../predictionEngine.js";

describe("poissonPmf", () => {
  it("returns valid probabilities", () => {
    const p0 = poissonPmf(0, 1.5);
    expect(p0).toBeGreaterThan(0);
    expect(p0).toBeLessThan(1);
  });
  it("sums to ~1 over k=0..20", () => {
    let sum = 0;
    for (let k = 0; k <= 20; k++) sum += poissonPmf(k, 2.3);
    expect(sum).toBeCloseTo(1, 4);
  });
  it("lambda=0 gives P(0)=1", () => {
    expect(poissonPmf(0, 0)).toBe(1);
    expect(poissonPmf(1, 0)).toBe(0);
  });
});

describe("scoreMatrix", () => {
  it("produces a 16x16 matrix summing to 1", () => {
    const m = scoreMatrix(1.5, 1.2);
    expect(m.length).toBe(16);
    let sum = 0;
    for (let i = 0; i <= 15; i++) for (let j = 0; j <= 15; j++) sum += m[i][j];
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe("derive1x2", () => {
  it("returns probabilities summing to 1", () => {
    const m = scoreMatrix(1.5, 1.2);
    const x = derive1x2(m);
    expect(x.home + x.draw + x.away).toBeCloseTo(1, 4);
  });
  it("favourite has higher probability", () => {
    const m = scoreMatrix(2.5, 0.8);
    const x = derive1x2(m);
    expect(x.home).toBeGreaterThan(x.away);
  });
});

describe("deriveOverUnder", () => {
  it("over + under = 1 for half line", () => {
    const m = scoreMatrix(1.5, 1.2);
    const ou = deriveOverUnder(m, 2.5);
    expect(ou.over + ou.under).toBeCloseTo(1, 4);
  });
});

describe("deriveBTTS", () => {
  it("yes + no = 1", () => {
    const m = scoreMatrix(1.5, 1.2);
    const btts = deriveBTTS(m);
    expect(btts.yes + btts.no).toBeCloseTo(1, 4);
  });
});

describe("deriveCorrectScore", () => {
  it("returns top scores sorted by probability", () => {
    const m = scoreMatrix(1.5, 1.2);
    const cs = deriveCorrectScore(m, 3);
    expect(cs.length).toBe(3);
    expect(cs[0].prob).toBeGreaterThanOrEqual(cs[1].prob);
  });
});

describe("eloExpected", () => {
  it("returns 0.5 for equal ratings", () => {
    expect(eloExpected(1500, 1500, 0)).toBeCloseTo(0.5);
  });
  it("higher rating gives higher expectation", () => {
    expect(eloExpected(1600, 1500, 0)).toBeGreaterThan(0.5);
  });
});

describe("eloUpdate", () => {
  it("increases rating on win", () => {
    const before = 1500;
    const after = eloUpdate(before, 1500, 1);
    expect(after).toBeGreaterThan(before);
  });
  it("decreases rating on loss", () => {
    const before = 1500;
    const after = eloUpdate(before, 1500, 0);
    expect(after).toBeLessThan(before);
  });
});

describe("ensembleLambdas", () => {
  it("blends lambdas by weight", () => {
    const r = ensembleLambdas(
      { lambdaHome: 2, lambdaAway: 1 },
      { lambdaHome: 1.5, lambdaAway: 1.5 },
      { lambdaHome: 1, lambdaAway: 2 },
      { goal: 0.5, elo: 0.3, feature: 0.2 }
    );
    expect(r.lambdaHome).toBeGreaterThan(1.4);
    expect(r.lambdaHome).toBeLessThan(2);
  });
});

describe("sigmoidCalibrate", () => {
  it("returns a probability in [0,1]", () => {
    const p = sigmoidCalibrate(0.7, 1.2, -0.1);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("predictMatch", () => {
  it("returns full prediction structure", () => {
    const pred = predictMatch(1.5, 1.2);
    expect(pred.x1x2).toBeDefined();
    expect(pred.overUnder25).toBeDefined();
    expect(pred.btts).toBeDefined();
    expect(pred.correctScore).toBeDefined();
    expect(pred.lambdaHome).toBeCloseTo(1.5);
    expect(pred.lambdaAway).toBeCloseTo(1.2);
  });
});

describe("validateDistribution", () => {
  it("validates a sum-1 distribution", () => {
    expect(validateDistribution([0.4, 0.35, 0.25])).toBe(true);
  });
  it("rejects a non-sum-1 distribution", () => {
    expect(validateDistribution([0.5, 0.6])).toBe(false);
  });
});