import { ok, type Result } from "../../shared/result/result";
import type { RequiredDocumentKey } from "../../domain/identifiers/identifiers";
import type { EngineDescriptor } from "../../domain/evaluation/engine-descriptor";
import type { RequiredDocumentIdentity } from "../../domain/documents/required-document";
import type { DocumentTargetSelector } from "../../rules/definitions/payloads";
import type { RuleFactView, ScopeBinding } from "../classify/fact-view";
import type { EngineError } from "../errors/engine-error";
import { resolveCountryTemplate } from "../evaluate/stage-context";
import {
  resolveProcedureTarget,
  type ProcedureIndex,
} from "../procedures/target-resolution";

export type DocumentTargetResolution =
  | Readonly<{ state: "MATCHED"; key: RequiredDocumentKey }>
  | Readonly<{ state: "NEGATIVELY_RESOLVED" }>
  | Readonly<{ state: "MISSING" }>
  | Readonly<{ state: "AMBIGUOUS"; candidates: readonly string[] }>
  | Readonly<{ state: "UNRESOLVED_TEMPLATE" }>;

export type DocumentIndexEntry = Readonly<{
  key: string;
  identity: RequiredDocumentIdentity;
  requirement: "REQUIRED" | "NOT_REQUIRED";
}>;

export type DocumentIndex = Readonly<{ entries: readonly DocumentIndexEntry[] }>;

/**
 * Resolves a document selector.
 *
 * A selector with `issuingCountry: null` is a wildcard over issuing countries;
 * if that wildcard matches more than one required document the rule is
 * ambiguous, which is a configuration error rather than a coin toss.
 */
export function resolveDocumentTarget(
  selector: DocumentTargetSelector,
  view: RuleFactView,
  binding: ScopeBinding | null,
  procedureIndex: ProcedureIndex,
  documentIndex: DocumentIndex,
  engine: EngineDescriptor,
): Result<DocumentTargetResolution, EngineError> {
  const procedure = resolveProcedureTarget(
    selector.forProcedure,
    view,
    binding,
    procedureIndex,
    engine,
  );
  if (!procedure.ok) {
    return procedure;
  }
  if (procedure.value.state !== "MATCHED") {
    return ok(procedure.value.state === "AMBIGUOUS"
      ? { state: "AMBIGUOUS", candidates: procedure.value.candidates }
      : { state: procedure.value.state });
  }

  const country = resolveCountryTemplate(selector.issuingCountry, view, binding);
  if (country.state === "UNRESOLVED") {
    return ok({ state: "UNRESOLVED_TEMPLATE" });
  }

  const matches = (entry: DocumentIndexEntry): boolean => {
    if ((entry.identity.forProcedure as string) !== (procedure.value as { key: string }).key) {
      return false;
    }
    if ((entry.identity.documentTypeId as string) !== (selector.documentTypeId as string)) {
      return false;
    }
    if (country.value !== null && entry.identity.issuingCountry !== country.value) {
      return false;
    }
    if (selector.discriminator !== null && entry.identity.discriminator !== selector.discriminator) {
      return false;
    }
    return true;
  };

  const required = documentIndex.entries.filter(
    (entry) => entry.requirement === "REQUIRED" && matches(entry),
  );
  if (required.length === 1) {
    return ok({ state: "MATCHED", key: (required[0] as DocumentIndexEntry).key as RequiredDocumentKey });
  }
  if (required.length > 1) {
    return ok({ state: "AMBIGUOUS", candidates: required.map((entry) => entry.key).sort() });
  }
  const negative = documentIndex.entries.filter(
    (entry) => entry.requirement === "NOT_REQUIRED" && matches(entry),
  );
  if (negative.length > 0) {
    return ok({ state: "NEGATIVELY_RESOLVED" });
  }
  return ok({ state: "MISSING" });
}
