import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
  // `server-only` throws on import outside a server component graph. Tests
  // still need to exercise server modules; the real package continues to guard
  // the production bundle.
  "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)),
};

/**
 * Logical test projects.
 *
 * The split is not cosmetic: `unit`, `rules`, `engine`, `golden` and
 * `property` are pure and must never touch a network or a database, while
 * `integration` and `persistence` require a real PostgreSQL instance and are
 * therefore never part of the default run.
 */
function project(name: string, include: readonly string[]) {
  return {
    resolve: { alias },
    test: {
      name,
      include: [...include],
      environment: "node" as const,
      globals: false,
    },
  };
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      project("unit", ["tests/unit/**/*.test.ts"]),
      project("rules", ["tests/rules/**/*.test.ts"]),
      project("engine", ["tests/engine/**/*.test.ts"]),
      project("golden", ["tests/golden/**/*.test.ts"]),
      project("property", ["tests/property/**/*.test.ts"]),
      project("application", ["tests/application/**/*.test.ts"]),
      project("architecture", ["tests/architecture/**/*.test.ts"]),
      project("security", ["tests/security/**/*.test.ts"]),
      project("integration", ["tests/integration/**/*.test.ts"]),
      project("persistence", ["tests/persistence/**/*.test.ts"]),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/case-engine/**/*.ts", "src/rules/**/*.ts"],
      exclude: ["**/index.ts"],
      thresholds: {
        "src/case-engine/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 90,
        },
        "src/rules/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 90,
        },
      },
    },
  },
});
