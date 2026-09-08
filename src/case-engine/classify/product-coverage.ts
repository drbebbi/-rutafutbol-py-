import type { CountryCode } from "../../domain/primitives/country";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type {
  ProductCoverageDecision,
  ProductCoverageProvenance,
  ProductCoverageRevision,
} from "../../domain/product/product";
import { isBundleEligible } from "../../domain/rules/publication";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type { EngineReadyBundleContent } from "../../rules/bundle/engine-ready-bundle";
import { compareStrings } from "../canonicalization/ordering";
import type { SpecialCaseGuardResult } from "./special-case-guard";

/**
 * The facts stage 1 is allowed to look at.
 *
 * Deliberately separate from `RuleFactView`: legal rules must not be able to
 * read product decisions, and product coverage must not be able to read the
 * document readiness a legal rule is forbidden to see either.
 */
export type ProductCoverageFactView = Readonly<{
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
export function projectProductCoverageFactView(facts: UserCaseFacts): ProductCoverageFactView {
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

export function withinWindow(
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

export type ProductCoverageResult = Readonly<{
  decision: ProductCoverageDecision;
  view: ProductCoverageFactView;
  blockingFactPaths: readonly RuleFactPath[];
}>;

function provenanceOf(revisions: readonly ProductCoverageRevision[]): readonly ProductCoverageProvenance[] {
  return [...revisions]
    .map((revision) => ({
      productCoverageId: revision.productCoverageId,
      productCoverageRevisionId: revision.productCoverageRevisionId,
    }))
    .sort((a, b) =>
      compareStrings(
        a.productCoverageRevisionId as string,
        b.productCoverageRevisionId as string,
      ),
    );
}

/**
 * Stage 1: the product coverage precheck.
 *
 * Reads the coverage table and nothing else. It answers one question - what
 * has the product said about this country and procedure - and it answers it
 * before any legal classification runs, so a classification can never be
 * shaped by what the product happens to support.
 */
export function runProductCoveragePrecheck(
  facts: UserCaseFacts,
  bundle: EngineReadyBundleContent,
  guard: SpecialCaseGuardResult,
): ProductCoverageResult {
  const view = projectProductCoverageFactView(facts);
  const blockingFactPaths: RuleFactPath[] = [];

  // A known special case is never terminated on country scope.
  if (guard.state === "CONFIRMED") {
    return {
      decision: { state: "BYPASSED_SPECIAL_CASE", provenance: [] },
      view,
      blockingFactPaths,
    };
  }

  if (view.coverageCountry === null) {
    if (view.coverageCountryBlockedBy !== null) {
      blockingFactPaths.push(view.coverageCountryBlockedBy);
    }
    return { decision: { state: "INDETERMINATE", provenance: [] }, view, blockingFactPaths };
  }

  const coverage = bundle.productCoverageRevisions.filter(
    (revision) =>
      isBundleEligible(revision.publicationStatus) &&
      withinWindow(revision.validFrom, revision.validUntil, bundle.effectiveLocalDate) &&
      revision.countryCode === view.coverageCountry &&
      revision.desiredProcedure === view.desiredProcedure,
  );

  if (coverage.length === 0) {
    // No coverage statement is not the same as "not supported": the product
    // simply has not researched this combination yet.
    return { decision: { state: "RESEARCH_REQUIRED", provenance: [] }, view, blockingFactPaths };
  }

  const states = new Set(coverage.map((revision) => revision.state));
  const decidedBy = (state: ProductCoverageRevision["state"]): readonly ProductCoverageProvenance[] =>
    provenanceOf(coverage.filter((revision) => revision.state === state));

  if (states.has("NOT_SUPPORTED")) {
    // The special-case guard must have been asked first; an unanswered signal
    // means we cannot terminate the case yet.
    if (guard.state === "POSSIBLE_UNANSWERED") {
      blockingFactPaths.push("case.specialCase.paraguayanCitizenship");
      return { decision: { state: "INDETERMINATE", provenance: [] }, view, blockingFactPaths };
    }
    return {
      decision: { state: "NOT_SUPPORTED", provenance: decidedBy("NOT_SUPPORTED") },
      view,
      blockingFactPaths,
    };
  }
  if (states.has("RESEARCH_REQUIRED")) {
    return {
      decision: { state: "RESEARCH_REQUIRED", provenance: decidedBy("RESEARCH_REQUIRED") },
      view,
      blockingFactPaths,
    };
  }
  if (states.has("PARTIAL")) {
    return {
      decision: { state: "PARTIAL", provenance: decidedBy("PARTIAL") },
      view,
      blockingFactPaths,
    };
  }
  return {
    decision: { state: "SUPPORTED", provenance: decidedBy("SUPPORTED") },
    view,
    blockingFactPaths,
  };
}
