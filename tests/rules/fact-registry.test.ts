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
    /*
     * Three families may look at what the applicant holds, and one more may
     * also look at entry readiness. Everything that decides a legal
     * *requirement* sees only the applicant's legal situation - in particular
     * DOCUMENT_REQUIREMENT, so no amount of readiness can make the law stop
     * asking for a document.
     */
    const mayReadDocumentState = new Set(["DOCUMENT_REUSE", "DOCUMENT_FORMALITY"]);
    const mayReadEntryReadiness = new Set(["WARNING", "TIMELINE"]);
    for (const family of RULE_FAMILIES) {
      const domains = allowedAccessDomainsForFamily(family);
      if (mayReadEntryReadiness.has(family)) {
        expect(domains, family).toEqual(["CASE_LEGAL", "DOCUMENT_STATE", "ENTRY_READINESS"]);
        continue;
      }
      if (mayReadDocumentState.has(family)) {
        expect(domains, family).toEqual(["CASE_LEGAL", "DOCUMENT_STATE"]);
        continue;
      }
      expect(domains, family).toEqual(["CASE_LEGAL"]);
    }
    expect(allowedAccessDomainsForFamily("DOCUMENT_REQUIREMENT")).toEqual(["CASE_LEGAL"]);
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
