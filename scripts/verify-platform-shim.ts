import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Migration 0000 must be a no-op on a real platform database.
 *
 * The compatibility shim exists so the migrations also run on a bare Postgres,
 * where Supabase's roles and `auth` helpers do not exist. On a real Supabase
 * database it must create nothing at all: a shim that redefines
 * `auth.uid()` would silently replace the platform's own identity function
 * with a copy that could drift from it.
 *
 * Applying it twice is the check. The second application has nothing left to
 * create, so anything it does create is something it should not have.
 */
const root = resolve(import.meta.dirname, "..");
const url = process.env["CEDULA_TEST_DATABASE_URL"] ?? process.env["SUPABASE_DB_URL"];

if (url === undefined || url === "") {
  console.error("CEDULA_TEST_DATABASE_URL or SUPABASE_DB_URL must be set.");
  process.exit(1);
}

const shim = join(root, "supabase", "migrations", "0000_platform_compatibility.sql");
const source = readFileSync(shim, "utf8");

/*
 * Every creation has to be conditional.
 *
 * At the top level that means `if not exists`. Inside a `do $$ ... $$` block
 * it means the surrounding PL/pgSQL guards it, which a text scan cannot judge
 * - so those are left to the empirical check below, which is the stronger one
 * anyway. `create or replace` is never acceptable here in any position: it is
 * precisely the shape that would overwrite the platform's own function.
 */
let depth = 0;
const unconditional: string[] = [];
for (const raw of source.split("\n")) {
  const line = raw.trim();
  if (/^do\s+\$\$/iu.test(line)) {
    depth += 1;
    continue;
  }
  if (line === "$$;" && depth > 0) {
    depth -= 1;
    continue;
  }
  if (/^create\s+or\s+replace\b/iu.test(line)) {
    unconditional.push(line);
    continue;
  }
  if (
    depth === 0 &&
    /^create\s+(?:function|role|schema|extension)\b/iu.test(line) &&
    !/if\s+not\s+exists/iu.test(line)
  ) {
    unconditional.push(line);
  }
}

if (unconditional.length > 0) {
  console.error("Migration 0000 contains statements that are not conditional:");
  for (const line of unconditional) {
    console.error(`  ${line}`);
  }
  console.error(
    "On a real Supabase database these would redefine platform objects rather than stand in for them.",
  );
  process.exit(1);
}

// And it must be idempotent in practice, not only by inspection.
const objectCount = (): string =>
  execFileSync(
    "psql",
    [
      "-t",
      "-A",
      "-d",
      url,
      "-c",
      `select
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth')
         || ':' ||
         (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role'))`,
    ],
    { encoding: "utf8" },
  ).trim();

const before = objectCount();
execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", url, "-f", shim], {
  stdio: ["ignore", "inherit", "inherit"],
});
const after = objectCount();

if (before !== after) {
  console.error(`Migration 0000 changed the platform objects: ${before} -> ${after}`);
  process.exit(1);
}

console.log("Platform compatibility shim: OK (no-op on an existing platform)");
