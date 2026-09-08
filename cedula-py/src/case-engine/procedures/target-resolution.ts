import { ok, type Result } from "../../shared/result/result";
import type { RequiredProcedureKey } from "../../domain/identifiers/identifiers";
import type { EngineDescriptor } from "../../domain/evaluation/engine-descriptor";
import type { ProcedureTargetSelector } from "../../rules/definitions/payloads";
import type { RuleFactView, ScopeBinding } from "../classify/fact-view";
import { makeRequiredProcedureKey } from "../canonicalization/keys";
import type { EngineError } from "../errors/engine-error";
import { resolveParameterTemplates } from "../evaluate/stage-context";

/**
 * How a downstream rule's pointer at an upstream procedure resolved.
 *
 * NEGATIVELY_RESOLVED is the interesting one: the target was *decided* not to
 * be required, so the downstream effect simply does not apply. That is a
 * different thing from MISSING, where nothing decided the target at all - which
 * means the knowledge base is incoherent and must be fixed, not guessed around.
 */
export type TargetResolutionState = "MATCHED" | "NEGATIVELY_RESOLVED" | "MISSING" | "AMBIGUOUS";

export type ProcedureTargetResolution =
  | Readonly<{ state: "MATCHED"; key: RequiredProcedureKey }>
  | Readonly<{ state: "NEGATIVELY_RESOLVED" }>
  | Readonly<{ state: "MISSING" }>
  | Readonly<{ state: "AMBIGUOUS"; candidates: readonly string[] }>
  /** The selector itself depends on a fact that is not known yet. */
  | Readonly<{ state: "UNRESOLVED_TEMPLATE" }>;

export type ProcedureIndex = Readonly<{
  requiredKeys: ReadonlySet<string>;
  negativeKeys: ReadonlySet<string>;
  /** procedureId -> required keys, for selectors that omit parameters. */
  requiredByProcedureId: ReadonlyMap<string, readonly string[]>;
  negativeByProcedureId: ReadonlyMap<string, readonly string[]>;
}>;

export function resolveProcedureTarget(
  selector: ProcedureTargetSelector,
  view: RuleFactView,
  binding: ScopeBinding | null,
  index: ProcedureIndex,
  engine: EngineDescriptor,
): Result<ProcedureTargetResolution, EngineError> {
  if (selector.parameters !== null) {
    const parameters = resolveParameterTemplates(selector.parameters, view, binding);
    if (!parameters.ok) {
      return parameters;
    }
    if (parameters.value.state === "UNRESOLVED") {
      return ok({ state: "UNRESOLVED_TEMPLATE" });
    }
    const key = makeRequiredProcedureKey(
      {
        procedureId: selector.procedureId,
        parameters: parameters.value.value,
        discriminator: selector.discriminator,
      },
      engine.derivedKeyFormatVersion,
    );
    if (!key.ok) {
      return key;
    }
    const asString = key.value as string;
    if (index.requiredKeys.has(asString)) {
      return ok({ state: "MATCHED", key: key.value });
    }
    if (index.negativeKeys.has(asString)) {
      return ok({ state: "NEGATIVELY_RESOLVED" });
    }
    return ok({ state: "MISSING" });
  }

  const procedureId = selector.procedureId as string;
  const matches = index.requiredByProcedureId.get(procedureId) ?? [];
  if (matches.length === 1) {
    return ok({ state: "MATCHED", key: matches[0] as RequiredProcedureKey });
  }
  if (matches.length > 1) {
    return ok({ state: "AMBIGUOUS", candidates: [...matches].sort() });
  }
  const negatives = index.negativeByProcedureId.get(procedureId) ?? [];
  if (negatives.length > 0) {
    return ok({ state: "NEGATIVELY_RESOLVED" });
  }
  return ok({ state: "MISSING" });
}
