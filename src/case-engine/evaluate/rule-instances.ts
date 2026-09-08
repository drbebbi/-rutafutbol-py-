import { err, ok, type Result } from "../../shared/result/result";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import { isSupportLevel, unresolvedReasonFor, type SupportLevel, type UnresolvedReason } from "../../domain/rules/verification";
import type { TruthValue } from "../../rules/definitions/ast";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { RuleRevision } from "../../rules/definitions/rule-revision";
import type { RuleFamily } from "../../rules/definitions/payloads";
import { evaluateCondition } from "../conditions/evaluate-condition";
import type { RuleFactView, ScopeBinding, ScopeCollection } from "../classify/fact-view";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";

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
  /** RESOLVED means the rule may state a consequence; UNRESOLVED may not. */
  resolution: "RESOLVED_CONSEQUENCE" | "UNRESOLVED_VERIFICATION";
  support: SupportLevel | null;
  unresolvedReason: UnresolvedReason | null;
  indeterminateFactPaths: readonly RuleFactPath[];
  unguardedNotApplicablePaths: readonly RuleFactPath[];
  provenance: ProvenanceRef;
}>;

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
  const support = isSupportLevel(revision.verificationStatus) ? revision.verificationStatus : null;
  const unresolvedReason = unresolvedReasonFor(revision.verificationStatus);
  const resolution = support === null ? "UNRESOLVED_VERIFICATION" : "RESOLVED_CONSEQUENCE";
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
        resolution,
        support,
        unresolvedReason,
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
      resolution,
      support,
      unresolvedReason,
      indeterminateFactPaths: outcome.value.indeterminateFactPaths,
      unguardedNotApplicablePaths: outcome.value.unguardedNotApplicablePaths,
      provenance,
    });
  }
  return ok(instances);
}
