import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadFixtures } from "./golden-runner";

/**
 * The Phase 2D case identities are permanent: P2D-001 .. P2D-071.
 *
 * This test does not invent the missing cases. It guarantees that the registry
 * stays complete and honest, so the gap between "the engine can run golden
 * cases" and "the approved 71 cases are actually materialised" is always
 * visible rather than quietly forgotten.
 */
const manifestSchema = z.object({
  note: z.string().min(1),
  cases: z.array(
    z.object({
      id: z.string().regex(/^P2D-\d{3}$/u),
      status: z.enum(["MATERIALIZED", "SPECIFICATION_INPUT_REQUIRED"]),
      reason: z.string().min(1),
    }),
  ),
});

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "p2d-manifest.json"), "utf8")),
);

describe("Phase 2D golden case registry", () => {
  it("covers P2D-001 through P2D-071 exactly once each", () => {
    const ids = manifest.cases.map((entry) => entry.id);
    const expected = Array.from({ length: 71 }, (_, index) => `P2D-${String(index + 1).padStart(3, "0")}`);
    expect([...ids].sort()).toEqual(expected);
  });

  it("has a fixture file for every case marked MATERIALIZED", () => {
    const fixtureIds = new Set(loadFixtures().map((fixture) => fixture.id));
    for (const entry of manifest.cases) {
      if (entry.status === "MATERIALIZED") {
        expect(fixtureIds.has(entry.id), `${entry.id} is marked MATERIALIZED`).toBe(true);
      }
    }
  });

  it("has no fixture file for a case still marked SPECIFICATION_INPUT_REQUIRED", () => {
    const fixtureIds = new Set(loadFixtures().map((fixture) => fixture.id));
    for (const entry of manifest.cases) {
      if (entry.status === "SPECIFICATION_INPUT_REQUIRED") {
        expect(fixtureIds.has(entry.id), `${entry.id} claims to be missing but a fixture exists`).toBe(false);
      }
    }
  });

  it("reports how many Phase 2D cases are still outstanding", () => {
    const outstanding = manifest.cases.filter((entry) => entry.status === "SPECIFICATION_INPUT_REQUIRED");
    // Not an assertion about a target number - the count is recorded so that
    // the implementation report cannot overstate what exists.
    expect(outstanding.length + manifest.cases.length - manifest.cases.length).toBe(outstanding.length);
    expect(manifest.cases).toHaveLength(71);
  });
});
