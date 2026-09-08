import { describe, expect, it } from "vitest";
import {
  ALL_RULE_FACT_PATHS,
  blockingIssueCodeForPath,
  isRegisteredFactPath,
  lookupFactPath,
  requiredRuleScopeForPath,
} from "../../src/rules/definitions/fact-paths";
import { BLOCKING_ISSUE_CODES } from "../../src/domain/evaluation/issues";
import { allowedPathScopesFor, RULE_SCOPES } from "../../src/rules/definitions/scopes";
import { allowedAccessDomainsForFamily, RULE_FAMILIES } from "../../src/rules/definitions/payloads";

describe("fact path registry", () => {
  it("covers the paths the decision model requires", () => {
    const required = [
      "case.desiredProcedure",
      "case.adultStatus",
      "case.location.kind",
      "case.location.countryCode",
      "case.maritalStatus",
      "case.residence.reportedType",
      "case.residence.card.state",
      "case.residence.card.expiryDate",
      "case.entryTravelDocumentCountry",
      "case.processTravelDocumentCountry",
      "case.citizenshipCountries",
      "case.citizenshipCount",
      "context.effectiveLocalDate",
      "scope.nationality.countryCode",
      "scope.nationality.roles",
      "scope.residenceHistory.countryCode",
      "scope.residenceHistory.from",
      "scope.residenceHistory.to",
      "scope.document.documentTypeId",
      "scope.document.issuingCountry",
      "scope.document.issueDate",
      "scope.document.expiryDate",
      "scope.document.language",
      "scope.document.readinessStatus",
    ];
    for (const path of required) {
      expect(isRegisteredFactPath(path), path).toBe(true);
    }
  });

  it("rejects unregistered paths instead of guessing", () => {
    expect(isRegisteredFactPath("case.favouriteColour")).toBe(false);
    expect(lookupFactPath("case.favouriteColour")).toBeNull();
  });

  it("maps every indeterminable path onto a closed blocking issue code", () => {
    for (const path of ALL_RULE_FACT_PATHS) {
      const code = blockingIssueCodeForPath(path);
      if (code !== null) {
        expect(BLOCKING_ISSUE_CODES).toContain(code);
      }
    }
  });

  it("only exempts paths that are structurally always determinate", () => {
    const exempt = ALL_RULE_FACT_PATHS.filter((path) => blockingIssueCodeForPath(path) === null);
    expect([...exempt].sort()).toEqual(["case.desiredProcedure", "context.effectiveLocalDate"]);
  });

  it("keeps document readiness out of the legal access domain", () => {
    expect(lookupFactPath("scope.document.readinessStatus")?.accessDomain).toBe("DOCUMENT_STATE");
    expect(lookupFactPath("case.entryEvidence.state")?.accessDomain).toBe("ENTRY_READINESS");
    for (const family of RULE_FAMILIES) {
      const domains = allowedAccessDomainsForFamily(family);
      if (family === "DOCUMENT_REUSE" || family === "WARNING" || family === "TIMELINE") {
        continue;
      }
      expect(domains, family).toEqual(["CASE_LEGAL"]);
    }
  });

  it("binds each scoped path to the scopes that can read it", () => {
    expect(requiredRuleScopeForPath("scope.nationality.roles")).toBe("NATIONALITY");
    expect(allowedPathScopesFor("CASE")).toEqual(["CASE", "CONTEXT"]);
    for (const scope of RULE_SCOPES) {
      expect(allowedPathScopesFor(scope)).toContain("CASE");
      expect(allowedPathScopesFor(scope)).toContain("CONTEXT");
    }
  });
});
