import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The release gate must actually block.
 *
 * A manifest that records the gap is only useful if something refuses to call
 * the build complete while the gap is open. This test drives the gate itself,
 * so the gate cannot be quietly reduced to a warning.
 */
const root = resolve(import.meta.dirname, "../..");

function runGate(): Readonly<{ status: number; output: string }> {
  try {
    const output = execFileSync("npx", ["tsx", "scripts/release-gate.ts"], {
      cwd: root,
      encoding: "utf8",
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("release gate", () => {
  it("fails while any Phase 2D case is outstanding, and says so in the agreed wording", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "tests", "golden", "p2d-manifest.json"), "utf8"),
    ) as { cases: readonly { status: string }[] };
    const materialized = manifest.cases.filter((entry) => entry.status === "MATERIALIZED").length;
    const total = manifest.cases.length;

    const result = runGate();

    if (materialized === total) {
      expect(result.status).toBe(0);
      return;
    }
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`P2D_GOLDEN_CORPUS_INCOMPLETE: ${materialized}/${total}`);
    expect(result.output).toContain("must not be invented");
  });
});
