import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CURRENT_ENGINE_DESCRIPTOR } from "../src/domain/evaluation/engine-descriptor";
import { evaluationBundleContentSchema } from "../src/rules/validation/schemas";
import { canonicalizeBundleContent, evaluationBundleContentHash } from "../src/rules/bundle/canonical-bundle";
import { prepareEngineReadyBundle } from "../src/rules/bundle/engine-ready-bundle";
import { canonicalJsonStringify } from "../src/shared/serialization/canonical-json";
import type { LocalDate } from "../src/domain/primitives/local-date";

/**
 * Verifies bundle determinism.
 *
 * Two properties an auditor has to be able to rely on:
 *  - the content hash depends only on decision-affecting content, not on the
 *    order rows happened to arrive in;
 *  - the bundle is engine-ready for the date it is assembled for.
 */
const root = resolve(import.meta.dirname, "..");
const directory = join(root, "tests", "golden", "rule-sets");
const effectiveLocalDate = (process.argv[2] ?? "2026-06-15") as LocalDate;

let failures = 0;
let verified = 0;

if (existsSync(directory)) {
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort()) {
    const raw: unknown = JSON.parse(readFileSync(join(directory, name), "utf8"));
    const parsed = evaluationBundleContentSchema.safeParse(raw);
    if (!parsed.success) {
      failures += 1;
      console.error(`[schema] ${name} could not be parsed`);
      continue;
    }
    const content = parsed.data;

    const hash = evaluationBundleContentHash(content);

    // Reversing every collection must not change the hash.
    const shuffled = {
      ...content,
      ruleRevisions: [...content.ruleRevisions].reverse(),
      evidence: [...content.evidence].reverse(),
      ruleSetRevisions: [...content.ruleSetRevisions].reverse(),
      feeIndexRevisions: [...content.feeIndexRevisions].reverse(),
      productCoverageRevisions: [...content.productCoverageRevisions].reverse(),
      pathwayDefinitionRevisions: [...content.pathwayDefinitionRevisions].reverse(),
    };
    if ((evaluationBundleContentHash(shuffled) as string) !== (hash as string)) {
      failures += 1;
      console.error(`[hash] ${name}: content hash depends on array order`);
    }

    // Canonicalisation must be idempotent.
    const once = canonicalJsonStringify(canonicalizeBundleContent(content));
    const twice = canonicalJsonStringify(canonicalizeBundleContent(canonicalizeBundleContent(content)));
    if (once !== twice) {
      failures += 1;
      console.error(`[canonical] ${name}: canonicalisation is not idempotent`);
    }

    const ready = prepareEngineReadyBundle(content, effectiveLocalDate, CURRENT_ENGINE_DESCRIPTOR);
    if (!ready.ok) {
      failures += 1;
      console.error(`[bundle] ${name}: not engine-ready on ${effectiveLocalDate}`);
      for (const issue of ready.error.slice(0, 5)) {
        console.error(`         ${JSON.stringify(issue)}`);
      }
      continue;
    }
    if ((ready.value.contentHash as string) !== (hash as string)) {
      failures += 1;
      console.error(`[bundle] ${name}: engine-ready hash differs from content hash`);
    }
    verified += 1;
    console.log(`${name}: ${hash as string}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} bundle verification failure(s).`);
  process.exit(1);
}

console.log(`Bundles: OK (${verified} verified for ${effectiveLocalDate})`);
