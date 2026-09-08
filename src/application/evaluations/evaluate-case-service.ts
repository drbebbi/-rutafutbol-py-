import { err, ok, type Result } from "../../shared/result/result";
import { JURISDICTION_TIME_ZONE } from "../../domain/primitives/time-zone";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { CaseEvaluationDecision } from "../../domain/evaluation/decision";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import {
  CURRENT_ENGINE_DESCRIPTOR,
  type EngineDescriptor,
} from "../../domain/evaluation/engine-descriptor";
import type { CaseEvaluationId, UserCaseId } from "../../domain/identifiers/identifiers";
import { createEvaluationExecutionContext } from "../../case-engine/date-math/execution-context";
import { evaluateCase } from "../../case-engine/evaluate/evaluate-case";
import type { EngineError } from "../../case-engine/errors/engine-error";
import { prepareEngineReadyBundle, type BundleValidationIssue } from "../../rules/bundle/engine-ready-bundle";
import { EVALUATION_BUNDLE_SCHEMA_VERSION } from "../../rules/bundle/bundle-content";
import type {
  CaseEvaluationRepositoryPort,
  ClockPort,
  EvaluationBundleStorePort,
  HashPort,
  KnowledgeReadPort,
  PortError,
} from "../ports/ports";

export type EvaluationFailure =
  | Readonly<{ kind: "ENGINE"; error: EngineError }>
  | Readonly<{ kind: "BUNDLE"; issues: readonly BundleValidationIssue[] }>
  | Readonly<{ kind: "PORT"; error: PortError }>;

export type EvaluationOutcome = Readonly<{
  decision: CaseEvaluationDecision;
  context: EvaluationExecutionContext;
  bundleContentHash: string;
  storedEvaluationId: CaseEvaluationId | null;
}>;

export type EvaluateCaseDependencies = Readonly<{
  clock: ClockPort;
  hash: HashPort;
  knowledge: KnowledgeReadPort;
  bundleStore: EvaluationBundleStorePort;
  evaluations: CaseEvaluationRepositoryPort;
  engine?: EngineDescriptor;
}>;

/**
 * The preflight that surrounds the pure engine.
 *
 * Everything impure happens here: reading the clock, loading the bundle,
 * persisting the result. The engine itself receives finished inputs and returns
 * a decision, which is what makes the decision reproducible from the stored
 * snapshot years later.
 */
export async function evaluateCaseForUser(
  facts: UserCaseFacts,
  dependencies: EvaluateCaseDependencies,
  persistFor: UserCaseId | null,
): Promise<Result<EvaluationOutcome, EvaluationFailure>> {
  const engine = dependencies.engine ?? CURRENT_ENGINE_DESCRIPTOR;

  const context = createEvaluationExecutionContext({
    evaluatedAt: dependencies.clock.nowInstant(),
    jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
  });
  if (!context.ok) {
    return err({ kind: "ENGINE", error: context.error });
  }

  // The bundle is loaded for exactly the date the engine will use.
  const content = await dependencies.knowledge.loadBundleContentFor(context.value.effectiveLocalDate);
  if (!content.ok) {
    return err({ kind: "PORT", error: content.error });
  }

  const bundle = prepareEngineReadyBundle(content.value, context.value.effectiveLocalDate, engine);
  if (!bundle.ok) {
    return err({ kind: "BUNDLE", issues: bundle.error });
  }

  const decision = evaluateCase(facts, context.value, bundle.value, engine);
  if (!decision.ok) {
    return err({ kind: "ENGINE", error: decision.error });
  }

  if (persistFor === null) {
    // Anonymous evaluations are never persisted: there is no case row, no
    // tracking identity and nothing to correlate later.
    return ok({
      decision: decision.value,
      context: context.value,
      bundleContentHash: bundle.value.contentHash as string,
      storedEvaluationId: null,
    });
  }

  const bundleId = await dependencies.bundleStore.materialize(
    bundle.value.contentHash,
    EVALUATION_BUNDLE_SCHEMA_VERSION,
    content.value,
  );
  if (!bundleId.ok) {
    return err({ kind: "PORT", error: bundleId.error });
  }

  const stored = await dependencies.evaluations.record({
    userCaseId: persistFor,
    evaluatedAt: context.value.evaluation.evaluatedAt,
    jurisdictionTimeZone: context.value.evaluation.jurisdictionTimeZone as string,
    effectiveLocalDate: context.value.effectiveLocalDate,
    engineVersion: engine.engineVersion as string,
    inputSchemaVersion: facts.factsSchemaVersion,
    inputHash: dependencies.hash.canonicalHash(facts),
    inputSnapshot: facts,
    evaluationBundleId: bundleId.value,
    evaluationSchemaVersion: engine.evaluationSchemaVersion,
    decision: decision.value,
  });
  if (!stored.ok) {
    return err({ kind: "PORT", error: stored.error });
  }

  return ok({
    decision: decision.value,
    context: context.value,
    bundleContentHash: bundle.value.contentHash as string,
    storedEvaluationId: stored.value,
  });
}
