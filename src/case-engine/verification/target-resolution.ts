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

function ambiguous(ruleId: RuleId, detail: string): EngineError {
  return ruleConfigurationError("VERIFICATION_TARGET_AMBIGUOUS", detail, ruleId);
}

/**
 * Resolves what an unresolved rule asks a human to verify.
 *
 * There is deliberately no fallback to `{ kind: "CASE" }`. A rule that names a
 * procedure and cannot be pointed at one is not "a question about the case in
 * general" - it is a rule that no longer matches the knowledge base, and
 * silently widening its target would hide exactly that.
 */
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
      const detail = `verification targets procedure "${template.targetProcedure.procedureId}"`;
      switch (resolved.value.state) {
        case "MATCHED":
          return ok({
            state: "RESOLVED",
            target: { kind: "PROCEDURE", procedureKey: resolved.value.key },
          });
        case "NEGATIVELY_RESOLVED":
          return ok({ state: "NOT_APPLICABLE" });
        case "AMBIGUOUS":
          return err(ambiguous(ruleId, `${detail} and matches ${resolved.value.candidates.join(", ")}`));
        case "MISSING":
          return err(missing(ruleId, `${detail}, which this case does not require`));
        case "UNRESOLVED_TEMPLATE":
          return err(
            ruleConfigurationError(
              "PARAMETER_FACT_UNRESOLVED",
              `${detail} whose parameters depend on an unknown fact`,
              ruleId,
            ),
          );
      }
      break;
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
      const detail = `verification targets document "${template.targetDocument.documentTypeId}"`;
      switch (resolved.value.state) {
        case "MATCHED":
          return ok({
            state: "RESOLVED",
            target: { kind: "DOCUMENT", documentKey: resolved.value.key },
          });
        case "NEGATIVELY_RESOLVED":
          return ok({ state: "NOT_APPLICABLE" });
        case "AMBIGUOUS":
          return err(ambiguous(ruleId, `${detail} and matches ${resolved.value.candidates.join(", ")}`));
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
      break;
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
      switch (resolved.value.state) {
        case "MATCHED":
          break;
        case "NEGATIVELY_RESOLVED":
          return ok({ state: "NOT_APPLICABLE" });
        case "AMBIGUOUS":
          return err(ambiguous(ruleId, `${detail} and matches ${resolved.value.candidates.join(", ")}`));
        case "MISSING":
          return err(missing(ruleId, `${detail}, which this case does not require`));
        case "UNRESOLVED_TEMPLATE":
          return err(
            ruleConfigurationError(
              "PARAMETER_FACT_UNRESOLVED",
              `${detail} whose parameters depend on an unknown fact`,
              ruleId,
            ),
          );
      }
      const procedureKey = resolved.value.key as RequiredProcedureKey;
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
  /* v8 ignore next 3 -- the switch above is exhaustive over a closed union; the guard exists so a future variant fails loudly. */
  return err(missing(ruleId, "unsupported verification target template"));
}
