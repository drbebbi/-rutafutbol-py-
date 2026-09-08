import { err, ok, type Result } from "../../shared/result/result";
import type { PathwayId } from "../../domain/identifiers/identifiers";
import type { CaseType } from "../../domain/case/classification";
import type { LocalDate } from "../../domain/primitives/local-date";
import { isBundleEligible } from "../../domain/rules/publication";
import type { PathwayDefinitionRevision } from "../../domain/product/product";
import type {
  RequiredProcedure,
  RequiredProcedureDependency,
} from "../../domain/procedures/procedure";
import type { EngineReadyBundleContent } from "../../rules/bundle/engine-ready-bundle";
import { compareStrings } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";

function withinWindow(validFrom: LocalDate, validUntil: LocalDate | null, on: LocalDate): boolean {
  const date = on as string;
  if (date < (validFrom as string)) {
    return false;
  }
  return validUntil === null || date <= (validUntil as string);
}

function sectionOrderFor(
  definition: PathwayDefinitionRevision,
  procedureKey: string,
): number | null {
  const sections = [...definition.payload.sections].sort((a, b) => a.order - b.order);
  for (const section of sections) {
    if (section.procedureKeyPatterns.some((pattern) => procedureKey.startsWith(pattern))) {
      return section.order;
    }
  }
  return null;
}

/**
 * Selects the single pathway that presents this case.
 *
 * Exactly one pathway must apply to an otherwise-complete supported case:
 * none means the presentation layer has nothing to show, several means the
 * knowledge base cannot say which one - both are configuration errors rather
 * than something to pick arbitrarily.
 *
 * A pathway may organise presentation freely, but it may not present a
 * procedure before one it depends on.
 */
export function selectPathway(
  bundle: EngineReadyBundleContent,
  caseType: CaseType,
  requiredProcedures: readonly RequiredProcedure[],
  dependencies: readonly RequiredProcedureDependency[],
): Result<PathwayId, EngineError> {
  const candidates = bundle.pathwayDefinitionRevisions
    .filter(
      (definition) =>
        isBundleEligible(definition.publicationStatus) &&
        withinWindow(definition.validFrom, definition.validUntil, bundle.effectiveLocalDate) &&
        definition.payload.appliesToCaseTypes.includes(caseType),
    )
    .sort((a, b) => compareStrings(a.pathwayId as string, b.pathwayId as string));

  const first = candidates[0];
  if (first === undefined) {
    return err(
      ruleConfigurationError("PATHWAY_MISSING", `no pathway definition applies to case type ${caseType}`),
    );
  }
  if (candidates.length > 1) {
    return err(
      ruleConfigurationError(
        "PATHWAY_AMBIGUOUS",
        `${candidates.length} pathway definitions apply to case type ${caseType}: ${candidates
          .map((definition) => definition.pathwayId as string)
          .join(", ")}`,
      ),
    );
  }

  const orderByKey = new Map<string, number | null>();
  for (const procedure of requiredProcedures) {
    orderByKey.set(procedure.key as string, sectionOrderFor(first, procedure.key as string));
  }

  for (const dependency of dependencies) {
    const dependentOrder = orderByKey.get(dependency.dependent as string);
    const prerequisiteOrder = orderByKey.get(dependency.dependsOn as string);
    if (
      dependentOrder === undefined ||
      prerequisiteOrder === undefined ||
      dependentOrder === null ||
      prerequisiteOrder === null
    ) {
      continue;
    }
    if (prerequisiteOrder > dependentOrder) {
      return err(
        ruleConfigurationError(
          "PATHWAY_VIOLATES_DEPENDENCIES",
          `pathway ${first.pathwayId} presents ${dependency.dependent} before its prerequisite ${dependency.dependsOn}`,
        ),
      );
    }
  }

  return ok(first.pathwayId);
}
