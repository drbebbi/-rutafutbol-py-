import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type {
  RequiredDocument,
  RequiredDocumentIdentity,
  RequiredFormality,
} from "../../domain/documents/required-document";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type {
  DocumentFormalityConsequence,
  DocumentRequirementConsequence,
  RequirementValue,
} from "../../rules/definitions/payloads";
import { makeRequiredDocumentKey } from "../canonicalization/keys";
import { compareStrings } from "../canonicalization/ordering";
import type { EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import {
  instancesOf,
  resolveCountryTemplate,
  slotCandidate,
  statedConsequence,
  type StageContext,
} from "../evaluate/stage-context";
import { classifyTargetOutcome } from "../evaluate/target-outcome";
import { resolveProcedureTarget, type ProcedureIndex } from "../procedures/target-resolution";
import { resolveDocumentTarget, type DocumentIndex, type DocumentIndexEntry } from "./target-resolution";

type RequirementConsequence = Readonly<{ requirement: RequirementValue }>;

export type DocumentStageResult = Readonly<{
  requiredDocuments: readonly RequiredDocument[];
  documentIndex: DocumentIndex;
  suppressedRuleIds: readonly string[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

/**
 * Document requirement + formality stage.
 *
 * Runs strictly after procedure materialisation: a document requirement always
 * hangs off a procedure, and evaluation is forward-only, so nothing produced
 * here can feed back into an earlier legal condition.
 */
export function runDocumentStage(
  stage: StageContext,
  procedureIndex: ProcedureIndex,
): Result<DocumentStageResult, EngineError> {
  const requirementCandidates: (SlotCandidate<RequirementConsequence> & {
    provenance: ProvenanceRef;
  })[] = [];
  const identities = new Map<string, RequiredDocumentIdentity>();
  const floatingPaths = new Set<RuleFactPath>();

  for (const instance of instancesOf(stage, "DOCUMENT_REQUIREMENT")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Grouped by family above; the cast records the invariant rather than
    // adding an unreachable branch.
    const stated = statedConsequence<DocumentRequirementConsequence>(instance);
    if (stated === null) {
      continue;
    }
    const target = resolveProcedureTarget(
      stated.consequence.forProcedure,
      stage.view,
      instance.binding,
      procedureIndex,
      stage.engine,
    );
    if (!target.ok) {
      return target;
    }
    const decision = classifyTargetOutcome(
      target.value.state,
      instance.truth,
      instance.revision.ruleId,
      `document requirement targets procedure "${stated.consequence.forProcedure.procedureId}" (${target.value.state})`,
    );
    if (!decision.ok) {
      return decision;
    }
    if (decision.value === "SKIP") {
      if (instance.truth === "INDETERMINATE") {
        for (const path of instance.indeterminateFactPaths) {
          floatingPaths.add(path);
        }
      }
      continue;
    }

    const country = resolveCountryTemplate(
      stated.consequence.issuingCountry,
      stage.view,
      instance.binding,
    );
    if (country.state === "UNRESOLVED") {
      const unresolved = classifyTargetOutcome(
        "UNRESOLVED_TEMPLATE",
        instance.truth,
        instance.revision.ruleId,
        "document issuing country depends on an unknown fact",
      );
      if (!unresolved.ok) {
        return unresolved;
      }
      for (const path of instance.indeterminateFactPaths) {
        floatingPaths.add(path);
      }
      continue;
    }

    const identity: RequiredDocumentIdentity = {
      forProcedure: (target.value as { key: RequiredDocumentIdentity["forProcedure"] }).key,
      documentTypeId: stated.consequence.documentTypeId,
      issuingCountry: country.value,
      discriminator: stated.consequence.discriminator,
    };
    const key = makeRequiredDocumentKey(identity, stage.engine.derivedKeyFormatVersion);
    if (!key.ok) {
      return key;
    }
    identities.set(key.value as string, identity);

    requirementCandidates.push(
      slotCandidate<RequirementConsequence>(
        instance,
        stated.support,
        `DOCUMENT_REQUIREMENT:${key.value as string}`,
        "DOCUMENT_REQUIREMENT",
        { requirement: stated.consequence.requirement },
      ),
    );
  }

  const resolvedRequirements = resolveSlots(requirementCandidates);
  if (!resolvedRequirements.ok) {
    return resolvedRequirements;
  }

  const indexEntries: DocumentIndexEntry[] = [];
  const suppressedRuleIds = new Set<string>();
  const relevantPaths = new Set<RuleFactPath>(floatingPaths);
  const decided = new Map<
    string,
    Readonly<{ identity: RequiredDocumentIdentity; support: RequiredDocument["support"]; provenance: readonly ProvenanceRef[] }>
  >();

  for (const resolution of resolvedRequirements.value) {
    const key = resolution.slotKey.slice("DOCUMENT_REQUIREMENT:".length);
    const identity = identities.get(key);
    /* v8 ignore next 3 -- every slot key was registered above; the guard protects a future refactor. */
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
    indexEntries.push({ key, identity, requirement: resolution.decided.consequence.requirement });
    if (resolution.decided.consequence.requirement === "REQUIRED") {
      decided.set(key, {
        identity,
        support: resolution.decided.support,
        provenance: resolution.decided.provenance,
      });
    }
  }

  const documentIndex: DocumentIndex = { entries: indexEntries };

  /* ---------------------------------------------------------------------- */
  /* Formalities                                                             */
  /* ---------------------------------------------------------------------- */

  const formalityCandidates: (SlotCandidate<RequirementConsequence> & { provenance: ProvenanceRef })[] = [];
  const formalitySlotMeta = new Map<string, Readonly<{ documentKey: string; formalityCode: string }>>();

  for (const instance of instancesOf(stage, "DOCUMENT_FORMALITY")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    const stated = statedConsequence<DocumentFormalityConsequence>(instance);
    if (stated === null) {
      continue;
    }
    const target = resolveDocumentTarget(
      stated.consequence.forDocument,
      stage.view,
      instance.binding,
      procedureIndex,
      documentIndex,
      stage.engine,
    );
    if (!target.ok) {
      return target;
    }
    const decision = classifyTargetOutcome(
      target.value.state,
      instance.truth,
      instance.revision.ruleId,
      `formality targets document "${stated.consequence.forDocument.documentTypeId}" (${target.value.state})`,
    );
    if (!decision.ok) {
      return decision;
    }
    if (decision.value === "SKIP") {
      if (instance.truth === "INDETERMINATE") {
        for (const path of instance.indeterminateFactPaths) {
          relevantPaths.add(path);
        }
      }
      continue;
    }
    const documentKey = (target.value as { key: string }).key;
    const slotKey = `FORMALITY:${documentKey}:${stated.consequence.formalityCode as string}`;
    formalitySlotMeta.set(slotKey, {
      documentKey,
      formalityCode: stated.consequence.formalityCode as string,
    });
    formalityCandidates.push(
      slotCandidate<RequirementConsequence>(instance, stated.support, slotKey, "FORMALITY", {
        requirement: stated.consequence.requirement,
      }),
    );
  }

  const resolvedFormalities = resolveSlots(formalityCandidates);
  if (!resolvedFormalities.ok) {
    return resolvedFormalities;
  }

  const formalitiesByDocument = new Map<string, RequiredFormality[]>();
  for (const resolution of resolvedFormalities.value) {
    const meta = formalitySlotMeta.get(resolution.slotKey);
    /* v8 ignore next 3 -- every slot key was registered above; the guard protects a future refactor. */
    if (meta === undefined) {
      continue;
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
    }
    if (resolution.decided === null || resolution.decided.consequence.requirement !== "REQUIRED") {
      continue;
    }
    const list = formalitiesByDocument.get(meta.documentKey) ?? [];
    list.push({
      formalityCode: meta.formalityCode as RequiredFormality["formalityCode"],
      support: resolution.decided.support,
      provenance: resolution.decided.provenance,
    });
    formalitiesByDocument.set(meta.documentKey, list);
  }

  const requiredDocuments: RequiredDocument[] = [...decided.entries()]
    .map(([key, value]) => ({
      key: key as RequiredDocument["key"],
      identity: value.identity,
      formalities: [...(formalitiesByDocument.get(key) ?? [])].sort((a, b) =>
        compareStrings(a.formalityCode as string, b.formalityCode as string),
      ),
      support: value.support,
      provenance: value.provenance,
    }))
    .sort((a, b) => compareStrings(a.key as string, b.key as string));

  return ok({
    requiredDocuments,
    documentIndex,
    suppressedRuleIds: [...suppressedRuleIds].sort(compareStrings),
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
