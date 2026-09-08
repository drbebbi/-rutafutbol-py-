import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import { JURISDICTION_TIME_ZONE } from "../../src/domain/primitives/time-zone";
import { createEvaluationExecutionContext } from "../../src/case-engine/date-math/execution-context";
import { evaluateCase } from "../../src/case-engine/evaluate/evaluate-case";
import { prepareEngineReadyBundle } from "../../src/rules/bundle/engine-ready-bundle";
import { evaluationBundleContentSchema } from "../../src/rules/validation/schemas";
import type { EvaluationBundleContent } from "../../src/rules/bundle/bundle-content";
import type { InstantString } from "../../src/domain/primitives/instant";
import { goldenFixtureSchema, toUserCaseFacts, type GoldenFixture } from "./fixture-schema";
import { projectDecision, type GoldenProjection } from "./projection";

const CASES_DIR = join(import.meta.dirname, "cases");
const RULE_SETS_DIR = join(import.meta.dirname, "rule-sets");

export function loadFixtures(): readonly GoldenFixture[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const raw: unknown = JSON.parse(readFileSync(join(CASES_DIR, name), "utf8"));
      const parsed = goldenFixtureSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`golden fixture ${name} is invalid: ${JSON.stringify(parsed.error.issues)}`);
      }
      return parsed.data;
    });
}

const ruleSetCache = new Map<string, EvaluationBundleContent>();

export function loadRuleSet(name: string): EvaluationBundleContent {
  const cached = ruleSetCache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const raw: unknown = JSON.parse(readFileSync(join(RULE_SETS_DIR, `${name}.json`), "utf8"));
  const parsed = evaluationBundleContentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`rule set ${name} is invalid: ${JSON.stringify(parsed.error.issues)}`);
  }
  ruleSetCache.set(name, parsed.data);
  return parsed.data;
}

export type GoldenRun =
  | Readonly<{ kind: "DECISION"; projection: GoldenProjection }>
  | Readonly<{ kind: "ENGINE_ERROR"; error: Readonly<{ kind: string; code: string }> }>;

/**
 * Runs a fixture through the whole pipeline: JSON -> schema -> mapper ->
 * domain -> engine -> canonical test projection.
 */
export function runFixture(fixture: GoldenFixture): GoldenRun {
  const contextResult = createEvaluationExecutionContext({
    evaluatedAt: fixture.evaluatedAt as InstantString,
    jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
  });
  if (!contextResult.ok) {
    throw new Error(`fixture ${fixture.id} has an unusable evaluatedAt`);
  }
  const context = contextResult.value;
  const bundleResult = prepareEngineReadyBundle(loadRuleSet(fixture.ruleSet), context.effectiveLocalDate);
  if (!bundleResult.ok) {
    throw new Error(`rule set ${fixture.ruleSet} is not engine-ready: ${JSON.stringify(bundleResult.error)}`);
  }
  const decision = evaluateCase(
    toUserCaseFacts(fixture.facts),
    context,
    bundleResult.value,
    CURRENT_ENGINE_DESCRIPTOR,
  );
  if (!decision.ok) {
    return { kind: "ENGINE_ERROR", error: { kind: decision.error.kind, code: decision.error.code } };
  }
  return { kind: "DECISION", projection: projectDecision(decision.value) };
}
