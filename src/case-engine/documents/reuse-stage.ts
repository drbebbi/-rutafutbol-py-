import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type {
  DocumentReuseAssessment,
  DocumentReuseResolution,
  RequiredDocument,
} from "../../domain/documents/required-document";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import { compareStrings, consequenceKeyOf } from "../canonicalization/ordering";
import type { EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import type { VerificationFlag } from "../../domain/evaluation/issues";
import { toVerificationFlag } from "../verification/flags";
import type { DocumentReuseRulePayload } from "../../rules/definitions/payloads";
import { dominatedRuleIds, instancesOf, type StageContext } from "../evaluate/stage-context";
import { classifyTargetOutcome } from "../evaluate/target-outcome";
import type { ProcedureIndex } from "../procedures/target-resolution";
import { resolveDocumentTarget, type DocumentIndex } from "./target-resolution";

type ReuseConsequence = Readonly<{ resolution: Exclude<DocumentReuseResolution, "REUSE_UNKNOWN"> }>;

export type ReuseStageResult = Readonly<{
  assessments: readonly DocumentReuseAssessment[];
  verifications: readonly VerificationFlag[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

/**
 * Document reuse is its own rule family with its own resolved values.
 *
 * The absence of a rule yields REUSE_UNKNOWN. It never yields "reusable",
 * never "not allowed" and never "must be reissued" - each of those would be an
 * invented legal claim, and each would mislead a user in a different direction.
 */
export function runReuseStage(
  stage: StageContext,
  procedureIndex: ProcedureIndex,
  documentIndex: DocumentIndex,
  requiredDocuments: readonly RequiredDocument[],
): Result<ReuseStageResult, EngineError> {
  const candidates: (SlotCandidate<ReuseConsequence> & { provenance: ProvenanceRef })[] = [];
  const relevantPaths = new Set<RuleFactPath>();

  for (const instance of instancesOf(stage, "DOCUMENT_REUSE")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Instances are grouped by family before this loop, so the payload is
    // known to be a DocumentReuseRulePayload; the cast records that invariant
    // instead of adding a branch that can never be taken.
    const payload = instance.revision.payload as DocumentReuseRulePayload;
    const target = resolveDocumentTarget(
      payload.consequence.forDocument,
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
      `reuse rule targets document "${payload.consequence.forDocument.documentTypeId}" (${target.value.state})`,
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
    const consequence: ReuseConsequence = { resolution: payload.consequence.resolution };
    candidates.push({
      slotKey: `DOCUMENT_REUSE:${documentKey}`,
      slotFamily: "DOCUMENT_REUSE",
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
  const byDocument = new Map<string, DocumentReuseAssessment>();

  for (const resolution of resolved.value) {
    const documentKey = resolution.slotKey.slice("DOCUMENT_REUSE:".length);
    const entry = documentIndex.entries.find((candidate) => candidate.key === documentKey);
    for (const verification of resolution.verifications) {
      verifications.push(
        toVerificationFlag(verification, {
          documentKey: documentKey as DocumentReuseAssessment["documentKey"],
          ...(entry === undefined ? {} : { procedureKey: entry.identity.forProcedure }),
        }),
      );
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    byDocument.set(documentKey, {
      documentKey: documentKey as DocumentReuseAssessment["documentKey"],
      resolution:
        resolution.decided === null ? "REUSE_UNKNOWN" : resolution.decided.consequence.resolution,
      support: resolution.decided === null ? null : resolution.decided.support,
      provenance: resolution.decided === null ? [] : resolution.decided.provenance,
    });
  }

  const assessments = requiredDocuments
    .map<DocumentReuseAssessment>(
      (document) =>
        byDocument.get(document.key as string) ?? {
          documentKey: document.key,
          resolution: "REUSE_UNKNOWN",
          support: null,
          provenance: [],
        },
    )
    .sort((a, b) => compareStrings(a.documentKey as string, b.documentKey as string));

  return ok({
    assessments,
    verifications,
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
