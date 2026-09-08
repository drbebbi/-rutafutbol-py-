import { err, ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { ProcedureRulePayload, RequirementValue } from "../../rules/definitions/payloads";
import type {
  RequiredProcedure,
  RequiredProcedureIdentity,
} from "../../domain/procedures/procedure";
import { makeRequiredProcedureKey } from "../canonicalization/keys";
import { compareStrings, consequenceKeyOf } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import type { VerificationFlag } from "../../domain/evaluation/issues";
import { toVerificationFlag } from "../verification/flags";
import {
  dominatedRuleIds,
  instancesOf,
  resolveParameterTemplates,
  type StageContext,
} from "../evaluate/stage-context";
import type { ProcedureIndex } from "./target-resolution";

type ProcedureConsequence = Readonly<{ requirement: RequirementValue }>;

export type ProcedureStageResult = Readonly<{
  requiredProcedures: readonly RequiredProcedure[];
  index: ProcedureIndex;
  verifications: readonly VerificationFlag[];
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
    // Instances are grouped by family before this loop, so the payload is
    // known to be a ProcedureRulePayload; the cast records that invariant
    // instead of adding a branch that can never be taken.
    const payload = instance.revision.payload as ProcedureRulePayload;
    const parameters = resolveParameterTemplates(
      payload.consequence.parameters,
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
      procedureId: payload.consequence.procedureId,
      parameters: parameters.value.value,
      discriminator: payload.consequence.discriminator,
    };
    const key = makeRequiredProcedureKey(identity, stage.engine.derivedKeyFormatVersion);
    if (!key.ok) {
      return key;
    }
    identities.set(key.value as string, identity);

    const consequence: ProcedureConsequence = { requirement: payload.consequence.requirement };
    candidates.push({
      slotKey: `PROCEDURE_REQUIREMENT:${key.value as string}`,
      slotFamily: "PROCEDURE_REQUIREMENT",
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

  const requiredProcedures: RequiredProcedure[] = [];
  const requiredKeys = new Set<string>();
  const negativeKeys = new Set<string>();
  const requiredByProcedureId = new Map<string, string[]>();
  const negativeByProcedureId = new Map<string, string[]>();
  const verifications: VerificationFlag[] = [];
  const relevantPaths = new Set<RuleFactPath>(floatingPaths);

  for (const resolution of resolved.value) {
    const key = resolution.slotKey.slice("PROCEDURE_REQUIREMENT:".length);
    const identity = identities.get(key);
    /* v8 ignore next 3 -- every slot key was registered in `identities` above; the guard exists so a future refactor fails loudly rather than silently. */
    if (identity === undefined) {
      continue;
    }
    for (const verification of resolution.verifications) {
      verifications.push(
        toVerificationFlag(verification, { procedureKey: key as RequiredProcedure["key"] }),
      );
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
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
    verifications,
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
