import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Rebuilds a local database from the migration files.
 *
 * The migrations are the schema source of truth: there is no ORM and no
 * dashboard-applied change. If a schema exists only because someone clicked it
 * into a console, it does not exist.
 */
const root = resolve(import.meta.dirname, "..");
const url = process.env["CEDULA_TEST_DATABASE_URL"];

if (url === undefined || url === "") {
  console.error("CEDULA_TEST_DATABASE_URL is not set.");
  process.exit(1);
}

const migrationsDir = join(root, "supabase", "migrations");
const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

for (const file of files) {
  process.stdout.write(`applying ${file}\n`);
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", url, "-f", join(migrationsDir, file)], {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

process.stdout.write("applying seed.sql\n");
execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", url, "-f", join(root, "supabase", "seed.sql")], {
  stdio: ["ignore", "inherit", "inherit"],
});

console.log("Database reset complete.");
