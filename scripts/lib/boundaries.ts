import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Import boundaries, enforced both as a merge-blocking test and as a CLI gate.
 *
 * The rules encode the architecture decisions directly: the domain and the
 * engine are pure, the engine performs no I/O, rules never reach a database,
 * and the UI never touches privileged infrastructure.
 */
export type BoundaryRule = Readonly<{
  layer: string;
  /** Source directory the rule applies to, relative to the repository root. */
  directory: string;
  /** Matchers a module in this layer may never import. */
  forbidden: readonly Readonly<{ pattern: RegExp; reason: string }>[];
}>;

const NEXT_OR_REACT = [
  { pattern: /^next(\/|$)/u, reason: "must not depend on the Next.js framework" },
  { pattern: /^react(-dom)?(\/|$)/u, reason: "must not depend on React" },
  { pattern: /^server-only$/u, reason: "must not depend on Next.js server primitives" },
];

const PERSISTENCE = [
  { pattern: /^@supabase\//u, reason: "must not reach Supabase directly" },
  { pattern: /^pg$/u, reason: "must not open a database connection" },
  { pattern: /(^|\/)infrastructure(\/|$)/u, reason: "must not depend on infrastructure" },
];

const IO = [
  { pattern: /^node:(fs|net|http|https|dns|child_process|worker_threads)/u, reason: "must perform no I/O" },
];

export const BOUNDARY_RULES: readonly BoundaryRule[] = [
  {
    layer: "domain",
    directory: "src/domain",
    forbidden: [
      ...NEXT_OR_REACT,
      ...PERSISTENCE,
      ...IO,
      { pattern: /(^|\/)app(\/|$)/u, reason: "must not depend on the app router" },
      { pattern: /(^|\/)ui(\/|$)/u, reason: "must not depend on the UI layer" },
      { pattern: /(^|\/)application(\/|$)/u, reason: "must not depend on the application layer" },
      { pattern: /(^|\/)case-engine(\/|$)/u, reason: "must not depend on the engine" },
      { pattern: /\.\.\/\.\.\/rules\//u, reason: "must not depend on the rule DSL" },
    ],
  },
  {
    layer: "rules",
    directory: "src/rules",
    forbidden: [
      ...NEXT_OR_REACT,
      ...PERSISTENCE,
      ...IO,
      { pattern: /(^|\/)app(\/|$)/u, reason: "must not depend on the app router" },
      { pattern: /(^|\/)ui(\/|$)/u, reason: "must not depend on the UI layer" },
      { pattern: /(^|\/)application(\/|$)/u, reason: "must not depend on the application layer" },
      { pattern: /(^|\/)case-engine(\/|$)/u, reason: "must not depend on the engine" },
    ],
  },
  {
    layer: "case-engine",
    directory: "src/case-engine",
    forbidden: [
      ...NEXT_OR_REACT,
      ...PERSISTENCE,
      ...IO,
      { pattern: /(^|\/)app(\/|$)/u, reason: "must not depend on the app router" },
      { pattern: /(^|\/)ui(\/|$)/u, reason: "must not depend on the UI layer" },
      { pattern: /(^|\/)application(\/|$)/u, reason: "must not depend on the application layer" },
      { pattern: /^zod$/u, reason: "must not parse untrusted input; bundles arrive validated" },
    ],
  },
  {
    layer: "application",
    directory: "src/application",
    forbidden: [
      ...NEXT_OR_REACT,
      { pattern: /^@supabase\//u, reason: "must talk to ports, not to Supabase" },
      { pattern: /^pg$/u, reason: "must talk to ports, not to a database driver" },
      { pattern: /(^|\/)infrastructure(\/|$)/u, reason: "must depend on ports, never on adapters" },
      { pattern: /(^|\/)ui(\/|$)/u, reason: "must not depend on the UI layer" },
    ],
  },
  {
    layer: "ui",
    directory: "src/ui",
    forbidden: [
      { pattern: /privileged/u, reason: "must never reach privileged infrastructure" },
      { pattern: /^@supabase\/supabase-js$/u, reason: "must use the request-scoped clients" },
      { pattern: /^pg$/u, reason: "must not open a database connection" },
    ],
  },
  {
    layer: "auth",
    directory: "src/auth",
    forbidden: [
      ...NEXT_OR_REACT,
      { pattern: /(^|\/)infrastructure(\/|$)/u, reason: "authorization policy stays free of adapters" },
      { pattern: /(^|\/)ui(\/|$)/u, reason: "must not depend on the UI layer" },
    ],
  },
];

export type BoundaryViolation = Readonly<{
  layer: string;
  file: string;
  specifier: string;
  reason: string;
}>;

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/gu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;
const REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/gu;

function collectFiles(directory: string): readonly string[] {
  const entries: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".ts") || full.endsWith(".tsx")) {
        entries.push(full);
      }
    }
  };
  walk(directory);
  return entries;
}

export function importSpecifiersOf(source: string): readonly string[] {
  const specifiers = new Set<string>();
  for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, REQUIRE_PATTERN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      specifiers.add(match[1] as string);
      match = pattern.exec(source);
    }
  }
  return [...specifiers].sort();
}

export function findBoundaryViolations(repositoryRoot: string): readonly BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const rule of BOUNDARY_RULES) {
    const directory = resolve(repositoryRoot, rule.directory);
    let files: readonly string[];
    try {
      files = collectFiles(directory);
    } catch {
      continue;
    }
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiersOf(source)) {
        for (const forbidden of rule.forbidden) {
          if (forbidden.pattern.test(specifier)) {
            violations.push({
              layer: rule.layer,
              file: relative(repositoryRoot, file),
              specifier,
              reason: forbidden.reason,
            });
          }
        }
      }
    }
  }
  return violations;
}
