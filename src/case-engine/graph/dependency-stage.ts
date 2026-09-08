import { err, ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type {
  RequiredProcedure,
  RequiredProcedureDependency,
} from "../../domain/procedures/procedure";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { DependencyRulePayload } from "../../rules/definitions/payloads";
import { compareStrings, consequenceKeyOf } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import type { VerificationFlag } from "../../domain/evaluation/issues";
import { toVerificationFlag } from "../verification/flags";
import { dominatedRuleIds, instancesOf, type StageContext } from "../evaluate/stage-context";
import { classifyTargetOutcome } from "../evaluate/target-outcome";
import { resolveProcedureTarget, type ProcedureIndex } from "../procedures/target-resolution";

type DependencyConsequence = Readonly<{ relation: "REQUIRED_BEFORE" | "NOT_REQUIRED_BEFORE" }>;

export type DependencyStageResult = Readonly<{
  dependencies: readonly RequiredProcedureDependency[];
  /** Topological order used to validate presentation, tie-broken by key. */
  topologicalOrder: readonly string[];
  verifications: readonly VerificationFlag[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

export function runDependencyStage(
  stage: StageContext,
  procedureIndex: ProcedureIndex,
  requiredProcedures: readonly RequiredProcedure[],
): Result<DependencyStageResult, EngineError> {
  const candidates: (SlotCandidate<DependencyConsequence> & { provenance: ProvenanceRef })[] = [];
  const slotMeta = new Map<string, Readonly<{ dependent: string; dependsOn: string }>>();
  const relevantPaths = new Set<RuleFactPath>();

  for (const instance of instancesOf(stage, "DEPENDENCY")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Grouped by family above; the cast records the invariant.
    const payload = instance.revision.payload as DependencyRulePayload;
    const dependent = resolveProcedureTarget(
      payload.consequence.dependent,
      stage.view,
      instance.binding,
      procedureIndex,
      stage.engine,
    );
    if (!dependent.ok) {
      return dependent;
    }
    const dependentDecision = classifyTargetOutcome(
      dependent.value.state,
      instance.truth,
      instance.revision.ruleId,
      `dependency's dependent procedure "${payload.consequence.dependent.procedureId}" (${dependent.value.state})`,
    );
    if (!dependentDecision.ok) {
      return dependentDecision;
    }
    const dependsOn = resolveProcedureTarget(
      payload.consequence.dependsOn,
      stage.view,
      instance.binding,
      procedureIndex,
      stage.engine,
    );
    if (!dependsOn.ok) {
      return dependsOn;
    }
    const dependsOnDecision = classifyTargetOutcome(
      dependsOn.value.state,
      instance.truth,
      instance.revision.ruleId,
      `dependency's prerequisite "${payload.consequence.dependsOn.procedureId}" (${dependsOn.value.state})`,
    );
    if (!dependsOnDecision.ok) {
      return dependsOnDecision;
    }
    if (dependentDecision.value === "SKIP" || dependsOnDecision.value === "SKIP") {
      if (instance.truth === "INDETERMINATE") {
        for (const path of instance.indeterminateFactPaths) {
          relevantPaths.add(path);
        }
      }
      continue;
    }

    const dependentKey = (dependent.value as { key: string }).key;
    const dependsOnKey = (dependsOn.value as { key: string }).key;
    if (dependentKey === dependsOnKey && payload.consequence.relation === "REQUIRED_BEFORE") {
      return err(
        ruleConfigurationError(
          "DEPENDENCY_SELF_LOOP",
          `procedure ${dependentKey} cannot depend on itself`,
          instance.revision.ruleId,
        ),
      );
    }

    const slotKey = `DEPENDENCY:${dependentKey}<-${dependsOnKey}`;
    slotMeta.set(slotKey, { dependent: dependentKey, dependsOn: dependsOnKey });
    const consequence: DependencyConsequence = { relation: payload.consequence.relation };
    candidates.push({
      slotKey,
      slotFamily: "DEPENDENCY",
      ruleId: instance.revision.ruleId,
      truth: instance.truth,
      resolution: instance.resolution,
      support: instance.support,
      unresolvedReason: instance.unresolvedReason,
      verification: instance.revision.verification,
      consequence: instance.resolution === "RESOLVED_CONSEQUENCE" ? consequence : null,
      consequenceKey:
        instance.resolution === "RESOLVED_CONSEQUENCE" ? consequenceKeyOf(consequence) : null,
      indeterminateFactPaths: instance.indeterminateFactPaths,
      unguardedNotApplicablePaths: instance.unguardedNotApplicablePaths,
      dominates: dominatedRuleIds(instance.revision),
      provenance: instance.provenance,
    });
  }

  const resolved = resolveSlots(candidates);
  if (!resolved.ok) {
    return resolved;
  }

  const verifications: VerificationFlag[] = [];
  const dependencies: RequiredProcedureDependency[] = [];
  for (const resolution of resolved.value) {
    const meta = slotMeta.get(resolution.slotKey);
    /* v8 ignore next 3 -- every slot key was registered above; the guard protects a future refactor. */
    if (meta === undefined) {
      continue;
    }
    for (const verification of resolution.verifications) {
      verifications.push(
        toVerificationFlag(verification, {
          procedureKey: meta.dependent as RequiredProcedure["key"],
        }),
      );
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    if (resolution.decided === null || resolution.decided.consequence.relation !== "REQUIRED_BEFORE") {
      continue;
    }
    dependencies.push({
      dependent: meta.dependent as RequiredProcedureDependency["dependent"],
      dependsOn: meta.dependsOn as RequiredProcedureDependency["dependsOn"],
      support: resolution.decided.support,
      provenance: resolution.decided.provenance,
    });
  }

  const order = topologicalOrder(requiredProcedures, dependencies);
  if (!order.ok) {
    return order;
  }

  return ok({
    dependencies: [...dependencies].sort((a, b) => {
      const byDependent = compareStrings(a.dependent as string, b.dependent as string);
      return byDependent !== 0 ? byDependent : compareStrings(a.dependsOn as string, b.dependsOn as string);
    }),
    topologicalOrder: order.value,
    verifications,
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}

/**
 * Kahn's algorithm with a lexical tie break on RequiredProcedureKey.
 *
 * The tie break is what makes the presentation order reproducible: without it,
 * two runs over the same DAG could legitimately emit different orders.
 */
export function topologicalOrder(
  requiredProcedures: readonly RequiredProcedure[],
  dependencies: readonly RequiredProcedureDependency[],
): Result<readonly string[], EngineError> {
  const nodes = requiredProcedures.map((procedure) => procedure.key as string).sort(compareStrings);
  const nodeSet = new Set(nodes);
  const incoming = new Map<string, Set<string>>(nodes.map((node) => [node, new Set<string>()]));
  const outgoing = new Map<string, Set<string>>(nodes.map((node) => [node, new Set<string>()]));

  for (const dependency of dependencies) {
    const dependent = dependency.dependent as string;
    const dependsOn = dependency.dependsOn as string;
    if (!nodeSet.has(dependent) || !nodeSet.has(dependsOn)) {
      // A dependency between procedures that are not both required is inert.
      continue;
    }
    if (dependent === dependsOn) {
      return err(
        ruleConfigurationError("DEPENDENCY_SELF_LOOP", `procedure ${dependent} depends on itself`),
      );
    }
    (incoming.get(dependent) as Set<string>).add(dependsOn);
    (outgoing.get(dependsOn) as Set<string>).add(dependent);
  }

  const ready = nodes.filter((node) => (incoming.get(node) as Set<string>).size === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(compareStrings);
    const node = ready.shift() as string;
    order.push(node);
    for (const dependent of [...(outgoing.get(node) as Set<string>)].sort(compareStrings)) {
      const remaining = incoming.get(dependent) as Set<string>;
      remaining.delete(node);
      if (remaining.size === 0) {
        ready.push(dependent);
      }
    }
  }

  if (order.length !== nodes.length) {
    const remaining = nodes.filter((node) => !order.includes(node)).sort(compareStrings);
    return err(
      ruleConfigurationError(
        "DEPENDENCY_CYCLE",
        `procedure dependency cycle among: ${remaining.join(", ")}`,
      ),
    );
  }
  return ok(order);
}
