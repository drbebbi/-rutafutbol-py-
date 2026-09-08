import { err, ok, type Result } from "../../shared/result/result";
import type { FeeComponentCode, RequiredProcedureKey, RuleId } from "../../domain/identifiers/identifiers";
import type { EngineDescriptor } from "../../domain/evaluation/engine-descriptor";
import type { VerificationTarget } from "../../domain/evaluation/issues";
import type { VerificationTargetTemplate } from "../../rules/definitions/payloads";
import type { RuleFactView, ScopeBinding } from "../classify/fact-view";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import { resolveProcedureTarget, type ProcedureIndex } from "../procedures/target-resolution";
import { resolveDocumentTarget, type DocumentIndex } from "../documents/target-resolution";

/**
 * Everything a verification target can be resolved against.
 *
 * The very same indexes the consequence stages produced, so a verification
 * request points at a procedure, document or fee component the decision
 * actually contains - not at one the rule author hoped for.
 */
export type VerificationResolutionContext = Readonly<{
  view: RuleFactView;
  procedureIndex: ProcedureIndex;
  documentIndex: DocumentIndex;
  /** `${procedureKey}|${componentCode}` for every fee component in the decision. */
  feeComponentKeys: ReadonlySet<string>;
  engine: EngineDescriptor;
}>;

/**
 * A resolved verification target, or NOT_APPLICABLE.
 *
 * NOT_APPLICABLE is reached only when the target was *decided* not to be
 * required - the procedure or document the rule asks about is explicitly not
 * part of this case. Asking a user to verify something the decision already
 * ruled out would be noise, so the request is dropped. Every other failure
 * mode is a defect: a target nothing decided (MISSING) or a target that
 * matches several things (AMBIGUOUS) stops the evaluation.
 */
export type ResolvedVerificationTarget =
  | Readonly<{ state: "RESOLVED"; target: VerificationTarget }>
  | Readonly<{ state: "NOT_APPLICABLE" }>;

function missing(ruleId: RuleId, detail: string): EngineError {
  return ruleConfigurationError("VERIFICATION_TARGET_MISSING", detail, ruleId);
}

/**
 * How a selector's outcome becomes a verification target, or a defect.
 *
 * The procedure, document and fee-component branches all resolve a selector
 * and all judge the result the same way, so they judge it in one place. The
 * asymmetry that matters is between NEGATIVELY_RESOLVED - the decision
 * explicitly ruled the target out, so the question is moot - and MISSING,
 * where nothing decided it at all and the rule is pointing at something that
 * does not exist.
 */
type SelectorOutcome<K> =
  | Readonly<{ state: "MATCHED"; key: K }>
  | Readonly<{ state: "NEGATIVELY_RESOLVED" }>
  | Readonly<{ state: "MISSING" }>
  | Readonly<{ state: "AMBIGUOUS"; candidates: readonly string[] }>
  | Readonly<{ state: "UNRESOLVED_TEMPLATE" }>;

type MatchedOrNot<K> =
  | Readonly<{ state: "MATCHED"; key: K }>
  | Readonly<{ state: "NOT_APPLICABLE" }>;

function classifySelectorOutcome<K>(
  resolved: SelectorOutcome<K>,
  ruleId: RuleId,
  detail: string,
): Result<MatchedOrNot<K>, EngineError> {
  switch (resolved.state) {
    case "MATCHED":
      return ok({ state: "MATCHED", key: resolved.key });
    case "NEGATIVELY_RESOLVED":
      return ok({ state: "NOT_APPLICABLE" });
    case "AMBIGUOUS":
      return err(
        ruleConfigurationError(
          "VERIFICATION_TARGET_AMBIGUOUS",
          `${detail} and matches ${resolved.candidates.join(", ")}`,
          ruleId,
        ),
      );
    case "MISSING":
      return err(missing(ruleId, `${detail}, which this case does not require`));
    case "UNRESOLVED_TEMPLATE":
      return err(
        ruleConfigurationError(
          "PARAMETER_FACT_UNRESOLVED",
          `${detail} whose selector depends on an unknown fact`,
          ruleId,
        ),
      );
  }
}

export function resolveVerificationTarget(
  template: VerificationTargetTemplate,
  binding: ScopeBinding | null,
  context: VerificationResolutionContext,
  ruleId: RuleId,
): Result<ResolvedVerificationTarget, EngineError> {
  switch (template.kind) {
    case "CASE":
      return ok({ state: "RESOLVED", target: { kind: "CASE" } });

    case "VISA_PURPOSE":
      // A literal purpose code, not a selector: there is nothing to match it
      // against, and an unresolved visa rule is precisely the case where no
      // visa decision exists to look it up in.
      return ok({
        state: "RESOLVED",
        target: { kind: "VISA_PURPOSE", purposeCode: template.purposeCode },
      });

    case "PROCEDURE": {
      const resolved = resolveProcedureTarget(
        template.targetProcedure,
        context.view,
        binding,
        context.procedureIndex,
        context.engine,
      );
      if (!resolved.ok) {
        return resolved;
      }
      const outcome = classifySelectorOutcome(
        resolved.value,
        ruleId,
        `verification targets procedure "${template.targetProcedure.procedureId}"`,
      );
      if (!outcome.ok) {
        return outcome;
      }
      return outcome.value.state === "NOT_APPLICABLE"
        ? ok({ state: "NOT_APPLICABLE" })
        : ok({
            state: "RESOLVED",
            target: { kind: "PROCEDURE", procedureKey: outcome.value.key },
          });
    }

    case "DOCUMENT": {
      const resolved = resolveDocumentTarget(
        template.targetDocument,
        context.view,
        binding,
        context.procedureIndex,
        context.documentIndex,
        context.engine,
      );
      if (!resolved.ok) {
        return resolved;
      }
      const outcome = classifySelectorOutcome(
        resolved.value,
        ruleId,
        `verification targets document "${template.targetDocument.documentTypeId}"`,
      );
      if (!outcome.ok) {
        return outcome;
      }
      return outcome.value.state === "NOT_APPLICABLE"
        ? ok({ state: "NOT_APPLICABLE" })
        : ok({
            state: "RESOLVED",
            target: { kind: "DOCUMENT", documentKey: outcome.value.key },
          });
    }

    case "FEE_COMPONENT": {
      const resolved = resolveProcedureTarget(
        template.targetProcedure,
        context.view,
        binding,
        context.procedureIndex,
        context.engine,
      );
      if (!resolved.ok) {
        return resolved;
      }
      const detail = `fee verification targets component "${template.componentCode}" of procedure "${template.targetProcedure.procedureId}"`;
      const outcome = classifySelectorOutcome(resolved.value, ruleId, detail);
      if (!outcome.ok) {
        return outcome;
      }
      if (outcome.value.state === "NOT_APPLICABLE") {
        return ok({ state: "NOT_APPLICABLE" });
      }
      const procedureKey = outcome.value.key as RequiredProcedureKey;
      const componentKey = `${procedureKey as string}|${template.componentCode as string}`;
      if (!context.feeComponentKeys.has(componentKey)) {
        return err(missing(ruleId, `${detail}, which this case does not calculate`));
      }
      return ok({
        state: "RESOLVED",
        target: {
          kind: "FEE_COMPONENT",
          procedureKey,
          componentCode: template.componentCode as FeeComponentCode,
        },
      });
    }
  }
}
