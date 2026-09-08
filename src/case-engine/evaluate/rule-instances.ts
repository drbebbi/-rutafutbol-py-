import { err, ok, type Result } from "../../shared/result/result";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import { isSupportLevel, type SupportLevel, type UnresolvedReason } from "../../domain/rules/verification";
import type { TruthValue } from "../../rules/definitions/ast";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { RuleRevision } from "../../rules/definitions/rule-revision";
import type { RuleFamily, UnresolvedRuleVerification } from "../../rules/definitions/payloads";
import { evaluateCondition } from "../conditions/evaluate-condition";
import type { RuleFactView, ScopeBinding, ScopeCollection } from "../classify/fact-view";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";

export type UnresolvedStatement = Readonly<{
  reason: UnresolvedReason;
  verification: UnresolvedRuleVerification;
}>;

/**
 * One evaluation of one rule against one scope binding.
 *
 * A CASE-scoped rule produces exactly one instance. A scoped rule produces one
 * instance per collection entry - or, if the collection itself is unknown, a
 * single indeterminate instance, because an unknown collection is not an empty
 * collection.
 */
export type RuleInstance = Readonly<{
  revision: RuleRevision;
  binding: ScopeBinding | null;
  truth: TruthValue;
  /**
   * Exactly one of these two is set, mirroring the payload's resolution.
   *
   * `support` present means the rule states a consequence and how well the
   * evidence backs it. `unresolved` present means the rule states no
   * consequence at all, only what a human has to verify.
   */
  support: SupportLevel | null;
  unresolved: UnresolvedStatement | null;
  indeterminateFactPaths: readonly RuleFactPath[];
  unguardedNotApplicablePaths: readonly RuleFactPath[];
  provenance: ProvenanceRef;
}>;

/** True when this instance states a consequence rather than a verification. */
export function statesConsequence(instance: RuleInstance): boolean {
  return instance.unresolved === null;
}

function provenanceOf(revision: RuleRevision): ProvenanceRef {
  return {
    ruleId: revision.ruleId,
    ruleRevisionId: revision.ruleRevisionId,
    sourceRevisionIds: [...revision.evidence.map((entry) => entry.sourceRevisionId)].sort((a, b) =>
      (a as string) < (b as string) ? -1 : 1,
    ),
  };
}

function collectionFor(view: RuleFactView, family: RuleFamily, revision: RuleRevision): Result<ScopeCollection | null, EngineError> {
  switch (revision.payload.scope) {
    case "CASE":
      return ok(null);
    case "EACH_NATIONALITY":
      return ok(view.nationalities);
    case "EACH_RESIDENCE_HISTORY_ENTRY":
      return ok(view.residenceHistory);
    case "EACH_DOCUMENT_INSTANCE":
      // Only families allowed to read DOCUMENT_STATE may iterate documents.
      if (family !== "DOCUMENT_REUSE" && family !== "WARNING" && family !== "TIMELINE") {
        return err(
          ruleConfigurationError(
            "UNSUPPORTED_SCOPE_FOR_FAMILY",
            `family ${family} may not be scoped EACH_DOCUMENT_INSTANCE`,
            revision.ruleId,
          ),
        );
      }
      return ok(view.documents);
  }
}

/** Representative fact path used to explain an indeterminate collection. */
function collectionPathFor(revision: RuleRevision): RuleFactPath {
  switch (revision.payload.scope) {
    case "EACH_NATIONALITY":
      return "scope.nationality.countryCode";
    case "EACH_RESIDENCE_HISTORY_ENTRY":
      return "scope.residenceHistory.from";
    case "EACH_DOCUMENT_INSTANCE":
      return "scope.document.documentTypeId";
    case "CASE":
      return "case.desiredProcedure";
  }
}

export function evaluateRuleInstances(
  revision: RuleRevision,
  view: RuleFactView,
  context: EvaluationExecutionContext,
): Result<readonly RuleInstance[], EngineError> {
  /*
   * The payload's resolution decides whether a consequence exists; the
   * revision's verification status only says how well the evidence backs it.
   * A revision whose two halves disagree is a configuration defect and stops
   * the evaluation rather than silently picking one of them.
   */
  const resolution = revision.payload.resolution;
  let support: SupportLevel | null = null;
  let unresolved: UnresolvedStatement | null = null;
  if (resolution.state === "RESOLVED") {
    if (!isSupportLevel(revision.verificationStatus)) {
      return err(
        ruleConfigurationError(
          "RESOLUTION_STATUS_MISMATCH",
          `rule "${revision.ruleId}" states a consequence but its evidence is ${revision.verificationStatus}`,
          revision.ruleId,
        ),
      );
    }
    support = revision.verificationStatus;
  } else {
    if (revision.verificationStatus !== resolution.reason) {
      return err(
        ruleConfigurationError(
          "RESOLUTION_STATUS_MISMATCH",
          `rule "${revision.ruleId}" is unresolved for ${resolution.reason} but its evidence is ${revision.verificationStatus}`,
          revision.ruleId,
        ),
      );
    }
    unresolved = { reason: resolution.reason, verification: resolution.verification };
  }
  const provenance = provenanceOf(revision);

  const collection = collectionFor(view, revision.payload.family, revision);
  if (!collection.ok) {
    return collection;
  }

  const bindings: (ScopeBinding | null)[] = [];
  if (collection.value === null) {
    bindings.push(null);
  } else if (collection.value.state === "KNOWN") {
    bindings.push(...collection.value.entries);
  } else {
    return ok([
      {
        revision,
        binding: null,
        truth: "INDETERMINATE",
        support,
        unresolved,
        indeterminateFactPaths: [collectionPathFor(revision)],
        unguardedNotApplicablePaths: [],
        provenance,
      },
    ]);
  }

  const instances: RuleInstance[] = [];
  for (const binding of bindings) {
    const outcome = evaluateCondition(
      revision.payload.condition,
      view,
      binding,
      context,
      revision.ruleId,
    );
    if (!outcome.ok) {
      return outcome;
    }
    instances.push({
      revision,
      binding,
      truth: outcome.value.value,
      support,
      unresolved,
      indeterminateFactPaths: outcome.value.indeterminateFactPaths,
      unguardedNotApplicablePaths: outcome.value.unguardedNotApplicablePaths,
      provenance,
    });
  }
  return ok(instances);
}
