import type { CountryCode } from "../../domain/primitives/country";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type {
  ProductAssessment,
  ProductBlockerCode,
  ProductCoverageRevision,
  ProductPolicyRevision,
  ProductWarningCode,
} from "../../domain/product/product";
import { isBundleEligible } from "../../domain/rules/publication";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { EngineReadyBundleContent } from "../../rules/bundle/engine-ready-bundle";
import type { SpecialCaseGuardResult } from "./special-case-guard";

/**
 * The product policy fact view.
 *
 * Deliberately separate from `RuleFactView`: legal rules must not be able to
 * read product decisions, and product policy must not be able to read the
 * document readiness a legal rule is forbidden to see either.
 */
export type ProductPolicyFactView = Readonly<{
  desiredProcedure: UserCaseFacts["classification"]["desiredProcedure"];
  coverageCountry: CountryCode | null;
  coverageCountryBlockedBy: RuleFactPath | null;
}>;

/**
 * Which country decides product coverage.
 *
 * The travel document the applicant will run the procedure on, if stated;
 * otherwise their citizenship - but only when there is exactly one, because a
 * dual national's coverage genuinely depends on which passport they use.
 */
export function projectProductPolicyFactView(facts: UserCaseFacts): ProductPolicyFactView {
  const classification = facts.classification;
  const processCountry = classification.processTravelDocumentCountry;
  if (processCountry.state === "KNOWN") {
    return {
      desiredProcedure: classification.desiredProcedure,
      coverageCountry: processCountry.value,
      coverageCountryBlockedBy: null,
    };
  }
  const nationalities = classification.nationalities;
  if (nationalities.state !== "KNOWN") {
    return {
      desiredProcedure: classification.desiredProcedure,
      coverageCountry: null,
      coverageCountryBlockedBy: "case.citizenshipCountries",
    };
  }
  const citizenships = nationalities.value.filter((entry) => entry.roles.includes("CITIZENSHIP"));
  const first = citizenships[0];
  if (citizenships.length === 1 && first !== undefined) {
    return {
      desiredProcedure: classification.desiredProcedure,
      coverageCountry: first.countryCode,
      coverageCountryBlockedBy: null,
    };
  }
  return {
    desiredProcedure: classification.desiredProcedure,
    coverageCountry: null,
    coverageCountryBlockedBy:
      citizenships.length === 0 ? "case.citizenshipCountries" : "case.processTravelDocumentCountry",
  };
}

function withinWindow(
  validFrom: LocalDate,
  validUntil: LocalDate | null,
  on: LocalDate,
): boolean {
  const date = on as string;
  if (date < (validFrom as string)) {
    return false;
  }
  return validUntil === null || date <= (validUntil as string);
}

export type ProductGateResult = Readonly<{
  assessment: ProductAssessment;
  view: ProductPolicyFactView;
  blockingFactPaths: readonly RuleFactPath[];
}>;

/**
 * Product coverage precheck.
 *
 * A ProductPolicy may declare a case unsupported, demand research or warn. It
 * may never create a required procedure, a required document, an official fee
 * or a legal formality, and it may never displace a legal rule - which is why
 * this function returns an assessment and nothing else.
 */
export function runProductGate(
  facts: UserCaseFacts,
  bundle: EngineReadyBundleContent,
  guard: SpecialCaseGuardResult,
): ProductGateResult {
  const view = projectProductPolicyFactView(facts);
  const blockers: ProductBlockerCode[] = [];
  const warnings: ProductWarningCode[] = [];
  const blockingFactPaths: RuleFactPath[] = [];

  const policies = bundle.productPolicyRevisions.filter(
    (policy: ProductPolicyRevision) =>
      isBundleEligible(policy.publicationStatus) &&
      withinWindow(policy.validFrom, policy.validUntil, bundle.effectiveLocalDate),
  );
  const procedureSupported =
    policies.length === 0 ||
    policies.some((policy) => policy.supportedDesiredProcedures.includes(view.desiredProcedure));

  if (!procedureSupported) {
    blockers.push("PROCEDURE_OUT_OF_SCOPE");
    return {
      assessment: { coverageState: "NOT_SUPPORTED", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }

  // A known special case is never terminated on country scope.
  if (guard.state === "CONFIRMED") {
    return {
      assessment: { coverageState: "BYPASSED_SPECIAL_CASE", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }

  if (view.coverageCountry === null) {
    if (view.coverageCountryBlockedBy !== null) {
      blockingFactPaths.push(view.coverageCountryBlockedBy);
    }
    return {
      assessment: { coverageState: "INDETERMINATE", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }

  const coverage = bundle.productCoverageRevisions.filter(
    (revision: ProductCoverageRevision) =>
      isBundleEligible(revision.publicationStatus) &&
      withinWindow(revision.validFrom, revision.validUntil, bundle.effectiveLocalDate) &&
      revision.countryCode === view.coverageCountry &&
      revision.desiredProcedure === view.desiredProcedure,
  );

  if (coverage.length === 0) {
    // No coverage statement is not the same as "not supported": the product
    // simply has not researched this combination yet.
    blockers.push("RESEARCH_INCOMPLETE");
    return {
      assessment: { coverageState: "RESEARCH_REQUIRED", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }

  const states = new Set(coverage.map((revision) => revision.state));
  if (states.has("NOT_SUPPORTED")) {
    // The special-case guard must have been asked first; an unanswered signal
    // means we cannot terminate the case yet.
    if (guard.state === "POSSIBLE_UNANSWERED") {
      blockingFactPaths.push("case.specialCase.paraguayanCitizenship");
      return {
        assessment: { coverageState: "INDETERMINATE", blockers, warnings },
        view,
        blockingFactPaths,
      };
    }
    blockers.push("COUNTRY_OUT_OF_SCOPE");
    return {
      assessment: { coverageState: "NOT_SUPPORTED", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }
  if (states.has("RESEARCH_REQUIRED")) {
    blockers.push("RESEARCH_INCOMPLETE");
    return {
      assessment: { coverageState: "RESEARCH_REQUIRED", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }
  if (states.has("PARTIAL")) {
    warnings.push("PARTIAL_COVERAGE");
    return {
      assessment: { coverageState: "PARTIAL", blockers, warnings },
      view,
      blockingFactPaths,
    };
  }
  return {
    assessment: { coverageState: "SUPPORTED", blockers, warnings },
    view,
    blockingFactPaths,
  };
}
