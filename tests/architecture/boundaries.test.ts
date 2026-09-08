import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOUNDARY_RULES, findBoundaryViolations, importSpecifiersOf } from "../../scripts/lib/boundaries";

const root = resolve(import.meta.dirname, "../..");

describe("architecture boundaries", () => {
  it("has no violations", () => {
    const violations = findBoundaryViolations(root);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("covers every layer the architecture constrains", () => {
    expect(BOUNDARY_RULES.map((rule) => rule.layer).sort()).toEqual([
      "application",
      "auth",
      "case-engine",
      "domain",
      "rules",
      "ui",
    ]);
  });

  it("detects static, dynamic and require imports", () => {
    const source = [
      'import { a } from "next/navigation";',
      'export { b } from "@supabase/supabase-js";',
      'const c = await import("pg");',
      'const d = require("node:fs");',
    ].join("\n");
    expect(importSpecifiersOf(source)).toEqual([
      "@supabase/supabase-js",
      "next/navigation",
      "node:fs",
      "pg",
    ]);
  });

  it("keeps the engine free of I/O and of a schema parser", () => {
    const engineRule = BOUNDARY_RULES.find((rule) => rule.layer === "case-engine");
    expect(engineRule?.forbidden.some((entry) => entry.pattern.test("node:fs"))).toBe(true);
    expect(engineRule?.forbidden.some((entry) => entry.pattern.test("zod"))).toBe(true);
    expect(engineRule?.forbidden.some((entry) => entry.pattern.test("@supabase/ssr"))).toBe(true);
  });
});
