import { err, ok, type Result } from "../../shared/result/result";
import type { EngineDescriptor } from "../../domain/evaluation/engine-descriptor";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import type { CountryCode } from "../../domain/primitives/country";
import type {
  ProcedureParameter,
  ProcedureParameterValue,
} from "../../domain/procedures/procedure";
import type { EngineReadyBundleContent } from "../../rules/bundle/engine-ready-bundle";
import type {
  CountryTemplate,
  DecisionSlotFamily,
  ProcedureParameterTemplate,
  RuleFamily,
} from "../../rules/definitions/payloads";
import type { SupportLevel } from "../../domain/rules/verification";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { SlotCandidate } from "../precedence/resolve-slot";
import { consequenceKeyOf } from "../canonicalization/ordering";
import type { RuleRevision } from "../../rules/definitions/rule-revision";
import type { RuleFactView, ScopeBinding } from "../classify/fact-view";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import type { RuleInstance } from "./rule-instances";

export type StageContext = Readonly<{
  view: RuleFactView;
  context: EvaluationExecutionContext;
  bundle: EngineReadyBundleContent;
  engine: EngineDescriptor;
  instancesByFamily: ReadonlyMap<RuleFamily, readonly RuleInstance[]>;
}>;

/** The set of rule ids a revision explicitly takes precedence over. */
export function dominatedRuleIds(revision: RuleRevision): ReadonlySet<string> {
  return new Set(revision.payload.precedence.map((edge) => edge.overRuleId as string));
}

export function instancesOf(stage: StageContext, family: RuleFamily): readonly RuleInstance[] {
  return stage.instancesByFamily.get(family) ?? [];
}

export type ConsequenceStatement<C> = Readonly<{ consequence: C; support: SupportLevel }>;

/**
 * The consequence this instance states, or null if it states none.
 *
 * The single gate between the two tracks of the engine. A rule whose payload
 * resolution is UNRESOLVED returns null here and can therefore never reach a
 * decision slot; its verification request is collected separately. Consequence
 * and support always travel together, so no stage can read one without the
 * other.
 */
export function statedConsequence<C>(instance: RuleInstance): ConsequenceStatement<C> | null {
  const resolution = instance.revision.payload.resolution;
  if (resolution.state !== "RESOLVED" || instance.support === null) {
    return null;
  }
  return { consequence: resolution.consequence as C, support: instance.support };
}

/** Builds the slot candidate for a stated consequence. */
export function slotCandidate<T>(
  instance: RuleInstance,
  support: SupportLevel,
  slotKey: string,
  slotFamily: DecisionSlotFamily,
  consequence: T,
): SlotCandidate<T> & { provenance: ProvenanceRef } {
  return {
    slotKey,
    slotFamily,
    ruleId: instance.revision.ruleId,
    truth: instance.truth,
    support,
    consequence,
    consequenceKey: consequenceKeyOf(consequence),
    indeterminateFactPaths: instance.indeterminateFactPaths,
    unguardedNotApplicablePaths: instance.unguardedNotApplicablePaths,
    dominates: dominatedRuleIds(instance.revision),
    provenance: instance.provenance,
  };
}

/**
 * Resolution of a template that depends on a fact.
 *
 * `UNRESOLVED` is not an error by itself: a rule whose condition is
 * indeterminate may legitimately be unable to name its own parameters yet. It
 * only becomes a configuration error if the rule is TRUE, because then it is
 * asserting something it cannot name.
 */
export type TemplateResolution<T> =
  | Readonly<{ state: "RESOLVED"; value: T }>
  | Readonly<{ state: "UNRESOLVED" }>;

function scalarFromCell(value: unknown): ProcedureParameterValue | null {
  if (typeof value === "string") {
    return { kind: "STRING", value };
  }
  if (typeof value === "boolean") {
    return { kind: "BOOLEAN", value };
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return { kind: "INTEGER", value };
  }
  return null;
}

function readTemplateCell(
  view: RuleFactView,
  binding: ScopeBinding | null,
  path: string,
): unknown {
  const caseCell = view.caseCells.get(path as never);
  if (caseCell !== undefined) {
    return caseCell.state === "KNOWN" ? caseCell.value : undefined;
  }
  if (binding === null) {
    return undefined;
  }
  const cell = binding.get(path as never);
  return cell !== undefined && cell.state === "KNOWN" ? cell.value : undefined;
}

export function resolveParameterTemplates(
  templates: readonly ProcedureParameterTemplate[],
  view: RuleFactView,
  binding: ScopeBinding | null,
): Result<TemplateResolution<readonly ProcedureParameter[]>, EngineError> {
  const parameters: ProcedureParameter[] = [];
  for (const template of templates) {
    if (template.value.kind === "LITERAL") {
      parameters.push({ name: template.name, value: template.value.literal });
      continue;
    }
    const raw = readTemplateCell(view, binding, template.value.path);
    if (raw === undefined) {
      return ok({ state: "UNRESOLVED" });
    }
    const scalar = scalarFromCell(raw);
    if (scalar === null) {
      return err(
        ruleConfigurationError(
          "PARAMETER_FACT_UNRESOLVED",
          `fact "${template.value.path}" cannot be used as a procedure parameter`,
        ),
      );
    }
    parameters.push({ name: template.name, value: scalar });
  }
  return ok({ state: "RESOLVED", value: parameters });
}

export function resolveCountryTemplate(
  template: CountryTemplate | null,
  view: RuleFactView,
  binding: ScopeBinding | null,
): TemplateResolution<CountryCode | null> {
  if (template === null) {
    return { state: "RESOLVED", value: null };
  }
  if (template.kind === "LITERAL") {
    return { state: "RESOLVED", value: template.countryCode };
  }
  const raw = readTemplateCell(view, binding, template.path);
  if (typeof raw !== "string") {
    return { state: "UNRESOLVED" };
  }
  return { state: "RESOLVED", value: raw as CountryCode };
}
