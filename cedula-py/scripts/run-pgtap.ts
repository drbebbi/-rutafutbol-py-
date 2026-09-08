import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Runs the pgTAP suite against a local PostgreSQL instance.
 *
 * Uses `supabase test db` when the Supabase CLI and its Docker stack are
 * available; falls back to psql against CEDULA_TEST_DATABASE_URL otherwise, so
 * the database tests can still run in environments without Docker.
 */
const root = resolve(import.meta.dirname, "..");
const url = process.env["CEDULA_TEST_DATABASE_URL"];

if (url === undefined || url === "") {
  console.error("CEDULA_TEST_DATABASE_URL is not set; cannot run the pgTAP suite.");
  process.exit(1);
}

const testsDir = join(root, "supabase", "tests", "database");
const files = readdirSync(testsDir).filter((name) => name.endsWith(".sql")).sort();

let failed = false;
for (const file of files) {
  process.stdout.write(`\n=== ${file} ===\n`);
  try {
    const output = execFileSync(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-d", url, "-f", join(testsDir, file)],
      { encoding: "utf8" },
    );
    process.stdout.write(output);
    if (/^not ok/mu.test(output)) {
      failed = true;
    }
  } catch (error) {
    process.stdout.write(String(error));
    failed = true;
  }
}

if (failed) {
  console.error("\npgTAP suite FAILED");
  process.exit(1);
}
console.log("\npgTAP suite passed");
