import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The Data API exposes exactly one schema.
 *
 * `app` is the only surface a browser role reaches. `core` is served through
 * the application's own read paths, and research, audit and security are never
 * exposed at all. This is configuration rather than code, so it is checked
 * rather than assumed - a one-word edit to config.toml would otherwise publish
 * the whole knowledge base through PostgREST.
 */
const root = resolve(import.meta.dirname, "..");
const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");

const match = /^\s*schemas\s*=\s*\[(?<list>[^\]]*)\]/mu.exec(config);
if (match?.groups?.["list"] === undefined) {
  console.error("supabase/config.toml declares no [api] schemas list.");
  process.exit(1);
}

const schemas = match.groups["list"]
  .split(",")
  .map((entry) => entry.trim().replace(/^["']|["']$/gu, ""))
  .filter((entry) => entry !== "");

if (schemas.length !== 1 || schemas[0] !== "app") {
  console.error(`The Data API must expose only "app", but config.toml exposes: ${schemas.join(", ")}`);
  process.exit(1);
}

console.log('Data API exposure: OK (only "app")');
