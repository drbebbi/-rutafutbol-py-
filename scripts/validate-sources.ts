import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluationBundleContentSchema } from "../src/rules/validation/schemas";
import { isSupportLevel } from "../src/domain/rules/verification";

/**
 * Validates source and evidence integrity.
 *
 * Two invariants that would otherwise only fail at publication time:
 *  - every rule that claims to be CONFIRMED or STRONG_EVIDENCE cites at least
 *    one source revision, and every cited source revision exists;
 *  - every unresolved rule declares what needs verifying, so an open question
 *    can never leave the system silently.
 */
const root = resolve(import.meta.dirname, "..");
const directories = [join(root, "tests", "golden", "rule-sets")];

let failures = 0;
let sources = 0;

for (const directory of directories) {
  if (!existsSync(directory)) {
    continue;
  }
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort()) {
    const raw: unknown = JSON.parse(readFileSync(join(directory, name), "utf8"));
    const parsed = evaluationBundleContentSchema.safeParse(raw);
    if (!parsed.success) {
      failures += 1;
      console.error(`[schema] ${name} could not be parsed`);
      continue;
    }

    const known = new Set(parsed.data.evidence.map((revision) => revision.sourceRevisionId as string));
    sources += known.size;

    for (const revision of parsed.data.ruleRevisions) {
      const ruleId = String(revision.ruleId);
      if (isSupportLevel(revision.verificationStatus)) {
        if (revision.evidence.length === 0) {
          failures += 1;
          console.error(`[evidence] ${name} ${ruleId}: ${revision.verificationStatus} rule cites no source`);
        }
        if (revision.payload.resolution.state !== "RESOLVED") {
          failures += 1;
          console.error(`[evidence] ${name} ${ruleId}: rule with support-level evidence states no consequence`);
        }
      } else if (revision.payload.resolution.state !== "UNRESOLVED") {
        failures += 1;
        console.error(`[evidence] ${name} ${ruleId}: unresolved rule declares nothing to verify`);
      } else if (revision.payload.resolution.reason !== revision.verificationStatus) {
        failures += 1;
        console.error(
          `[evidence] ${name} ${ruleId}: unresolved for ${revision.payload.resolution.reason} but evidence status is ${revision.verificationStatus}`,
        );
      }

      for (const evidence of revision.evidence) {
        if (!known.has(evidence.sourceRevisionId as string)) {
          failures += 1;
          console.error(`[evidence] ${name} ${ruleId}: cites unknown source ${String(evidence.sourceRevisionId)}`);
        }
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} source validation failure(s).`);
  process.exit(1);
}

console.log(`Sources: OK (${sources} source revisions referenced)`);
