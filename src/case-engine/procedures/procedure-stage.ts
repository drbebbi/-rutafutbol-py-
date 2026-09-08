import { err, ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type {
  ProcedureRequirementConsequence,
  RequirementValue,
} from "../../rules/definitions/payloads";
import type {
  RequiredProcedure,
  RequiredProcedureIdentity,
} from "../../domain/procedures/procedure";
import { makeRequiredProcedureKey } from "../canonicalization/keys";
import { compareStrings } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import {
  instancesOf,
  resolveParameterTemplates,
  slotCandidate,
  statedConsequence,
  type StageContext,
} from "../evaluate/stage-context";
import type { ProcedureIndex } from "./target-resolution";

type ProcedureConsequence = Readonly<{ requirement: RequirementValue }>;

export type ProcedureStageResult = Readonly<{
  requiredProcedures: readonly RequiredProcedure[];
  index: ProcedureIndex;
  suppressedRuleIds: readonly string[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

/**
 * Procedure requirement stage.
 *
 * Rules state REQUIRED or NOT_REQUIRED for a semantically identified
 * procedure. Identity is content-derived, so two rules that require the same
 * thing land in the same slot and merge; two that disagree conflict and need
 * explicit precedence.
 */
export function runProcedureStage(stage: StageContext): Result<ProcedureStageResult, EngineError> {
  const candidates: (SlotCandidate<ProcedureConsequence> & { provenance: ProvenanceRef })[] = [];
  const identities = new Map<string, RequiredProcedureIdentity>();
  const floatingPaths = new Set<RuleFactPath>();

  for (const instance of instancesOf(stage, "PROCEDURE")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Instances are grouped by family before this loop, so the consequence is
    // known to be a procedure requirement; the cast records that invariant
    // instead of adding a branch that can never be taken.
    const stated = statedConsequence<ProcedureRequirementConsequence>(instance);
    if (stated === null) {
      // States a verification request rather than a requirement.
      continue;
    }
    const parameters = resolveParameterTemplates(
      stated.consequence.parameters,
      stage.view,
      instance.binding,
    );
    if (!parameters.ok) {
      return parameters;
    }
    if (parameters.value.state === "UNRESOLVED") {
      if (instance.truth === "TRUE") {
        return err(
          ruleConfigurationError(
            "PARAMETER_FACT_UNRESOLVED",
            `rule "${instance.revision.ruleId}" asserts a procedure whose parameters depend on an unknown fact`,
            instance.revision.ruleId,
          ),
        );
      }
      for (const path of instance.indeterminateFactPaths) {
        floatingPaths.add(path);
      }
      continue;
    }

    const identity: RequiredProcedureIdentity = {
      procedureId: stated.consequence.procedureId,
      parameters: parameters.value.value,
      discriminator: stated.consequence.discriminator,
    };
    const key = makeRequiredProcedureKey(identity, stage.engine.derivedKeyFormatVersion);
    if (!key.ok) {
      return key;
    }
    identities.set(key.value as string, identity);

    candidates.push(
      slotCandidate<ProcedureConsequence>(
        instance,
        stated.support,
        `PROCEDURE_REQUIREMENT:${key.value as string}`,
        "PROCEDURE_REQUIREMENT",
        { requirement: stated.consequence.requirement },
      ),
    );
  }

  const resolved = resolveSlots(candidates);
  if (!resolved.ok) {
    return resolved;
  }

  const requiredProcedures: RequiredProcedure[] = [];
  const requiredKeys = new Set<string>();
  const negativeKeys = new Set<string>();
  const requiredByProcedureId = new Map<string, string[]>();
  const negativeByProcedureId = new Map<string, string[]>();
  const suppressedRuleIds = new Set<string>();
  const relevantPaths = new Set<RuleFactPath>(floatingPaths);

  for (const resolution of resolved.value) {
    const key = resolution.slotKey.slice("PROCEDURE_REQUIREMENT:".length);
    const identity = identities.get(key);
    /* v8 ignore next 3 -- every slot key was registered in `identities` above; the guard exists so a future refactor fails loudly rather than silently. */
    if (identity === undefined) {
      continue;
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
    }
    if (resolution.decided === null) {
      continue;
    }
    if (resolution.decided.consequence.requirement === "REQUIRED") {
      requiredKeys.add(key);
      const list = requiredByProcedureId.get(identity.procedureId as string) ?? [];
      list.push(key);
      requiredByProcedureId.set(identity.procedureId as string, list);
      requiredProcedures.push({
        key: key as RequiredProcedure["key"],
        identity,
        support: resolution.decided.support,
        provenance: resolution.decided.provenance,
      });
    } else {
      negativeKeys.add(key);
      const list = negativeByProcedureId.get(identity.procedureId as string) ?? [];
      list.push(key);
      negativeByProcedureId.set(identity.procedureId as string, list);
    }
  }

  return ok({
    requiredProcedures: [...requiredProcedures].sort((a, b) =>
      compareStrings(a.key as string, b.key as string),
    ),
    index: {
      requiredKeys,
      negativeKeys,
      requiredByProcedureId,
      negativeByProcedureId,
    },
    suppressedRuleIds: [...suppressedRuleIds].sort(compareStrings),
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
