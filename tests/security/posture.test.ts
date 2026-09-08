import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  syntheticKnowledgeEnabled,
  SYNTHETIC_KNOWLEDGE_ENVIRONMENTS,
} from "../../src/infrastructure/environment/synthetic-knowledge";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summariseDecision, wizardAnswersToFacts } from "../../src/application/cases/wizard-mapping";
import { runEngine, expectOk } from "../fixtures/engine";
import { firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import { caseTypePayload } from "../fixtures/payloads";

const root = resolve(import.meta.dirname, "../..");

function readAll(directory: string, extensions: readonly string[]): readonly { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      if (name === "node_modules" || name === ".next" || name === "coverage") {
        continue;
      }
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (extensions.some((extension) => full.endsWith(extension))) {
        files.push({ path: full, source: readFileSync(full, "utf8") });
      }
    }
  };
  walk(directory);
  return files;
}

/**
 * These scans assert what the CODE does, so comments are stripped first.
 * Otherwise a comment explaining why `getSession()` must not be used would
 * fail the very test that enforces it.
 */
function stripTypeScriptComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

function stripSqlComments(source: string): string {
  return source.replace(/--.*$/gmu, "");
}

const sourceFiles = readAll(join(root, "src"), [".ts", ".tsx"]).map((file) => ({
  path: file.path,
  source: stripTypeScriptComments(file.source),
  raw: file.source,
}));
const migrationFiles = readAll(join(root, "supabase", "migrations"), [".sql"]).map((file) => ({
  path: file.path,
  source: stripSqlComments(file.source),
  raw: file.source,
}));

describe("authentication identity", () => {
  it("never uses getSession() as the authoritative server identity", () => {
    for (const file of sourceFiles) {
      expect(file.source, file.path).not.toContain("getSession()");
    }
  });

  it("resolves identity from verified claims, falling back to the auth server", () => {
    const identity = sourceFiles.find((file) => file.path.endsWith("supabase/auth/identity.ts"));
    expect(identity).toBeDefined();
    expect(identity?.source).toContain("auth.getClaims()");
    expect(identity?.source).toContain("auth.getUser()");
  });

  it("never derives administrative authority from user metadata", () => {
    for (const file of sourceFiles) {
      expect(file.source, file.path).not.toMatch(/user_metadata\s*[.[]\s*['"]?admin/u);
    }
    // Authority comes from `security.admin_authorizations`, and only from the
    // internal reader: the request-scoped client never touches that table.
    const reader = sourceFiles.find((file) =>
      file.path.endsWith("internal/admin-authorization-adapter.ts"),
    );
    expect(reader?.source).toContain("security.admin_authorizations");

    const identity = sourceFiles.find((file) => file.path.endsWith("supabase/auth/identity.ts"));
    expect(identity?.source).toContain("findActiveRolesForUser");
    expect(identity?.source).not.toContain("admin_authorizations");
  });

  it("reads administrative authority on the internal path, never through the user's client", () => {
    for (const file of sourceFiles) {
      if (file.path.endsWith("internal/admin-authorization-adapter.ts")) {
        continue;
      }
      // A request-scoped Data API client carries the requester's own
      // privileges; asking it whether the requester is an administrator asks
      // the wrong party, and the browser roles cannot reach `security` anyway.
      expect(file.source, file.path).not.toMatch(/schema\(\s*["']security["']\s*\)/u);
    }
  });

  it("fails closed when administrative authority cannot be read", () => {
    const identity = sourceFiles.find((file) => file.path.endsWith("supabase/auth/identity.ts"));
    // No identity at all, rather than an identity with no roles: the second
    // would read as "signed in, not an administrator".
    expect(identity?.source).toMatch(/if \(!roles\.ok\) \{\s*return null;/u);
  });
});

describe("request scoping", () => {
  it("creates a Supabase server client per request rather than as a singleton", () => {
    const server = sourceFiles.find((file) => file.path.endsWith("infrastructure/supabase/server.ts"));
    expect(server?.source).toContain("export async function createSupabaseServerClient");
    // A module-level client would carry one user's session into the next
    // request; the factory shape is what prevents that.
    expect(server?.source).not.toMatch(/^const\s+\w+\s*=\s*createServerClient/mu);
  });

  it("keeps the privileged client server-only", () => {
    const privileged = sourceFiles.find((file) => file.path.endsWith("infrastructure/supabase/privileged.ts"));
    expect(privileged?.raw).toContain('import "server-only"');
    expect(privileged?.source).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("never references the service role key outside server-only or registry modules", () => {
    // The environment validator and the data-classification registry name the
    // variable so it can be validated and classified; they never read it.
    const registryModules = [
      "infrastructure/environment/env.ts",
      "application/security/data-classification.ts",
    ];
    for (const file of sourceFiles) {
      if (!file.source.includes("SUPABASE_SERVICE_ROLE_KEY")) {
        continue;
      }
      const isServerOnly = file.raw.includes('import "server-only"');
      const isRegistry = registryModules.some((suffix) => file.path.endsWith(suffix));
      expect(isServerOnly || isRegistry, file.path).toBe(true);
    }
  });
});

describe("no executable rules", () => {
  it("never evaluates a persisted rule as code", () => {
    for (const file of sourceFiles) {
      expect(file.source, file.path).not.toMatch(/\beval\s*\(/u);
      expect(file.source, file.path).not.toMatch(/new\s+Function\s*\(/u);
    }
  });

  it("stores rule payloads as data and says so in the schema", () => {
    const core = migrationFiles.find((file) => file.path.endsWith("0002_core_knowledge.sql"));
    expect(core?.source.toLowerCase()).toContain("never executable code");
  });
});

describe("database posture is expressed in the migrations", () => {
  it("grants no INSERT on evaluations to the normal runtime", () => {
    const grants = migrationFiles.find((file) => file.path.endsWith("0007_rls_and_grants.sql"));
    expect(grants?.source).toContain("grant select on app.case_evaluations to cedula_runtime_role;");
    expect(grants?.source).not.toMatch(/grant[^;]*insert[^;]*app\.case_evaluations[^;]*runtime/iu);
  });

  it("never grants BYPASSRLS or SUPERUSER to a runtime role", () => {
    for (const file of migrationFiles) {
      expect(file.source.toLowerCase(), file.path).not.toContain("bypassrls");
      expect(file.source.toLowerCase(), file.path).not.toContain("superuser");
    }
  });

  it("hardens every SECURITY DEFINER function", () => {
    for (const file of migrationFiles) {
      const definerCount = (file.source.match(/security definer/gu) ?? []).length;
      const searchPathCount = (file.source.match(/set search_path = ''/gu) ?? []).length;
      expect(searchPathCount, file.path).toBeGreaterThanOrEqual(definerCount);
    }
  });
});

describe("no secrets in the repository", () => {
  it("keeps .env.example to names and placeholders", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    expect(example).toContain("NEXT_PUBLIC_SUPABASE_URL=");
    // Placeholders only: every value is either a local URL or an angle-bracket
    // placeholder.
    for (const line of example.split("\n")) {
      const match = /^[A-Z_]+="(.*)"$/u.exec(line.trim());
      if (match === null) {
        continue;
      }
      const value = match[1] ?? "";
      const isPlaceholder =
        value.includes("<") ||
        value.startsWith("http://localhost") ||
        value.startsWith("postgresql://postgres@127.0.0.1") ||
        value === "LOCAL";
      expect(isPlaceholder, line).toBe(true);
    }
  });

  it("ignores real env files", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain(".env");
    expect(ignore).toContain("!.env.example");
  });

  it("contains no JWT-shaped or key-shaped literals in source", () => {
    for (const file of sourceFiles) {
      expect(file.source, file.path).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./u);
      expect(file.source, file.path).not.toMatch(/sb_secret_[A-Za-z0-9]{10,}/u);
    }
  });
});

describe("data exposure", () => {
  it("returns counts and codes to the browser, never the facts behind them", () => {
    resetRuleCounter();
    const decision = expectOk(
      runEngine(
        wizardAnswersToFacts({
          citizenship: "DE",
          residence: "NONE",
          holdsPreviousCedula: false,
          paraguayanSpouse: false,
        }),
        [rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))],
        {
          productPolicyRevisions: [firstCedulaPolicy()],
          productCoverageRevisions: [supportedCoverage("DE")],
          pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
        },
      ),
    );
    const summary = summariseDecision(decision);
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain("nationalities");
    expect(serialised).not.toContain("residenceHistory");
    expect(serialised).not.toContain("specialCase");
    expect(serialised).not.toContain("provenance");
    expect(Object.keys(summary).sort()).toEqual([
      "blockingIssues",
      "caseType",
      "requiredDocumentCount",
      "requiredProcedureCount",
      "status",
      "verificationFlags",
    ]);
  });

  it("exposes only the app schema through the Data API", () => {
    const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
    expect(config).toContain('schemas = ["app"]');
    expect(config).not.toMatch(/schemas\s*=\s*\[[^\]]*security/u);
    expect(config).not.toMatch(/schemas\s*=\s*\[[^\]]*research/u);
    expect(config).not.toMatch(/schemas\s*=\s*\[[^\]]*audit/u);
  });

  it("configures exact redirect URLs with no wildcard", () => {
    const config = readFileSync(join(root, "supabase", "config.toml"), "utf8");
    expect(config).toContain("additional_redirect_urls");
    expect(config).not.toContain("**");
  });
});

describe("anonymous privacy", () => {
  it("has no code path that persists an anonymous case", () => {
    const service = sourceFiles.find((file) =>
      file.path.endsWith("application/evaluations/evaluate-case-service.ts"),
    );
    expect(service?.source).toContain("if (persistFor === null)");
    expect(service?.raw).toContain("Anonymous evaluations are never persisted");
  });

  it("keeps the seed free of legal rules", () => {
    const seed = readFileSync(join(root, "supabase", "seed.sql"), "utf8");
    expect(seed).toContain("DELIBERATELY CONTAINS NO LEGAL RULES");
    expect(seed.toLowerCase()).not.toContain("insert into core.rule_revisions");
  });
});

describe("the synthetic knowledge fixture route", () => {
  /**
   * The route serves invented rules. It has to be impossible to switch on by
   * accident, so every condition is checked explicitly and none defaults to
   * "enabled".
   */
  const enabled = { NODE_ENV: "development", CEDULA_ENVIRONMENT: "LOCAL", CEDULA_SYNTHETIC_KNOWLEDGE: "1" };

  it("serves only when every condition is met explicitly", () => {
    expect(syntheticKnowledgeEnabled(enabled)).toBe(true);
    for (const environment of SYNTHETIC_KNOWLEDGE_ENVIRONMENTS) {
      expect(syntheticKnowledgeEnabled({ ...enabled, CEDULA_ENVIRONMENT: environment })).toBe(true);
    }
  });

  it("refuses in a production build, whatever else is set", () => {
    expect(syntheticKnowledgeEnabled({ ...enabled, NODE_ENV: "production" })).toBe(false);
  });

  it("refuses when the environment is unset, rather than assuming LOCAL", () => {
    expect(syntheticKnowledgeEnabled({ ...enabled, CEDULA_ENVIRONMENT: undefined })).toBe(false);
  });

  it("refuses an environment it does not recognise", () => {
    // Including PRODUCTION, but the point is the default: a renamed or
    // misspelled environment is refused, not waved through.
    for (const environment of ["PRODUCTION", "STAGING", "local", "", "Local"]) {
      expect(syntheticKnowledgeEnabled({ ...enabled, CEDULA_ENVIRONMENT: environment }), environment).toBe(false);
    }
  });

  it("refuses unless synthetic knowledge is switched on by name", () => {
    expect(syntheticKnowledgeEnabled({ ...enabled, CEDULA_SYNTHETIC_KNOWLEDGE: "0" })).toBe(false);
    expect(syntheticKnowledgeEnabled({ ...enabled, CEDULA_SYNTHETIC_KNOWLEDGE: "true" })).toBe(false);
    expect(syntheticKnowledgeEnabled({ ...enabled, CEDULA_SYNTHETIC_KNOWLEDGE: undefined })).toBe(false);
  });

  it("reads the gate rather than re-deriving it in the route", () => {
    const route = sourceFiles.find((file) => file.path.endsWith("test-fixtures/evaluate/route.ts"));
    expect(route?.source).toContain("syntheticKnowledgeEnabled(process.env)");
    expect(route?.source).not.toContain("!== \"PRODUCTION\"");
  });
});
