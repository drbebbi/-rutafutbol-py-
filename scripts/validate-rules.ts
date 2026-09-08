import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluationBundleContentSchema } from "../src/rules/validation/schemas";
import { validateRuleRevisionStructure } from "../src/rules/validation/structural-validation";
import { validatePrecedenceGraph } from "../src/rules/conflicts/precedence-validation";

/**
 * Validates every rule set that ships in the repository.
 *
 * The same checks a publication has to pass: wire schema, structural
 * admissibility (limits, fact access, scope, operator compatibility, evidence,
 * verification declarations) and the precedence graph.
 *
 * Only synthetic test rule sets exist today; production rule content may only
 * come from the approved research baseline.
 */
const root = resolve(import.meta.dirname, "..");
const ruleSetDirectories = [join(root, "tests", "golden", "rule-sets")];

let failures = 0;
let checked = 0;

for (const directory of ruleSetDirectories) {
  if (!existsSync(directory)) {
    continue;
  }
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort()) {
    const path = join(directory, name);
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const parsed = evaluationBundleContentSchema.safeParse(raw);
    if (!parsed.success) {
      failures += 1;
      console.error(`[schema] ${name}: ${JSON.stringify(parsed.error.issues.slice(0, 5), null, 2)}`);
      continue;
    }

    for (const revision of parsed.data.ruleRevisions) {
      checked += 1;
      for (const issue of validateRuleRevisionStructure(revision)) {
        failures += 1;
        console.error(`[structure] ${name} ${String(issue.ruleId)}: ${issue.code} - ${issue.detail}`);
      }
    }

    for (const issue of validatePrecedenceGraph(parsed.data.ruleRevisions)) {
      failures += 1;
      console.error(`[precedence] ${name} ${String(issue.ruleId)}: ${issue.code} - ${issue.detail}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} rule validation failure(s).`);
  process.exit(1);
}

console.log(`Rules: OK (${checked} rule revisions validated)`);
