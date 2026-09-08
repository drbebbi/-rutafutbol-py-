import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The release gate.
 *
 * One job: make it impossible to describe this build as complete while the
 * approved Phase 2D golden corpus is not materialised. The golden suite can
 * pass with five synthetic cases, the coverage thresholds can be met, every
 * other gate can be green - and none of that says the 71 approved cases have
 * been run, because they do not exist yet.
 *
 * The gate exits non-zero while any of them is outstanding. That is the point:
 * a release that cannot state 71/71 is not a release.
 */
type ManifestEntry = Readonly<{
  id: string;
  status: "MATERIALIZED" | "SPECIFICATION_INPUT_REQUIRED";
  reason: string;
}>;

type Manifest = Readonly<{ note: string; cases: readonly ManifestEntry[] }>;

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "tests", "golden", "p2d-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

const total = manifest.cases.length;
const materialized = manifest.cases.filter((entry) => entry.status === "MATERIALIZED").length;
const outstanding = total - materialized;

process.stdout.write(`P2D golden corpus: ${materialized}/${total} materialised\n`);

if (outstanding > 0) {
  process.stdout.write(`P2D_GOLDEN_CORPUS_INCOMPLETE: ${materialized}/${total}\n`);
  process.stdout.write(
    `${outstanding} case(s) still carry SPECIFICATION_INPUT_REQUIRED. ` +
      "The original Phase 2D inputs are not in the repository and must not be invented; " +
      "this build cannot be marked complete.\n",
  );
  process.exit(1);
}

process.stdout.write("Release gate: OK\n");
