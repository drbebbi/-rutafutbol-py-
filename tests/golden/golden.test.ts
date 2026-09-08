import { describe, expect, it } from "vitest";
import { loadFixtures, runFixture } from "./golden-runner";

const fixtures = loadFixtures();

describe("golden cases", () => {
  it("has at least one fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))("%s", (_id, fixture) => {
    const run = runFixture(fixture);
    const expected = fixture.expected as Record<string, unknown>;
    if (expected["kind"] === "ENGINE_ERROR") {
      expect(run.kind).toBe("ENGINE_ERROR");
      expect(run.kind === "ENGINE_ERROR" && run.error).toEqual(expected["error"]);
      return;
    }
    expect(run.kind).toBe("DECISION");
    if (run.kind !== "DECISION") {
      return;
    }
    const rest = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== "kind"));
    expect(run.projection).toEqual(rest);
  });

  it("is reproducible: running a fixture twice gives the identical projection", () => {
    for (const fixture of fixtures) {
      expect(runFixture(fixture)).toEqual(runFixture(fixture));
    }
  });
});
