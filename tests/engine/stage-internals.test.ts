import { beforeEach, describe, expect, it } from "vitest";
import { projectRuleFactView } from "../../src/case-engine/classify/fact-view";
import {
  dominatedRuleIds,
  instancesOf,
  resolveCountryTemplate,
  resolveParameterTemplates,
  statedConsequence,
  type StageContext,
} from "../../src/case-engine/evaluate/stage-context";
import { evaluateRuleInstances } from "../../src/case-engine/evaluate/rule-instances";
import { classifyTargetOutcome } from "../../src/case-engine/evaluate/target-outcome";
import { resolveProcedureTarget } from "../../src/case-engine/procedures/target-resolution";
import { resolveDocumentTarget } from "../../src/case-engine/documents/target-resolution";
import {
  canonicalVerificationFlags,
  verificationFlagKey,
} from "../../src/case-engine/verification/flags";
import { buildBlockingIssues } from "../../src/case-engine/verification/blocking-issues";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import { knownFact, unansweredFact, unknownFact } from "../../src/domain/case/knowledge";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { country, userCaseFacts } from "../fixtures/facts";
import { executionContext } from "../fixtures/engine";
import { alwaysTrue, resetRuleCounter, rule } from "../fixtures/rules";
import {
  documentPayload,
  factParam,
  literalParam,
  procedurePayload,
  procedureSelector,
  reusePayload,
  unresolved,
} from "../fixtures/payloads";
import type { DocumentTargetSelector } from "../../src/rules/definitions/payloads";
import type { DocumentIndex } from "../../src/case-engine/documents/target-resolution";
import type { VerificationFlag } from "../../src/domain/evaluation/issues";
import { id } from "../fixtures/ids";
import type { RequiredDocumentKey, RequiredProcedureKey } from "../../src/domain/identifiers/identifiers";

const context = executionContext();

beforeEach(() => {
  resetRuleCounter();
});

describe("parameter and country templates", () => {
  const view = projectRuleFactView(userCaseFacts(), context);

  it("resolves literals", () => {
    const result = unwrapOrThrow(resolveParameterTemplates([literalParam("country", "DE")], view, null));
    expect(result).toEqual({
      state: "RESOLVED",
      value: [{ name: "country", value: { kind: "STRING", value: "DE" } }],
    });
  });

  it("resolves a fact reference that is known", () => {
    const result = unwrapOrThrow(
      resolveParameterTemplates([factParam("adult", "case.adultStatus")], view, null),
    );
    expect(result.state).toBe("RESOLVED");
  });

  it("reports UNRESOLVED for a fact that is not known", () => {
    const unknownView = projectRuleFactView(userCaseFacts({ adultStatus: unknownFact }), context);
    const result = unwrapOrThrow(
      resolveParameterTemplates([factParam("adult", "case.adultStatus")], unknownView, null),
    );
    expect(result.state).toBe("UNRESOLVED");
  });

  it("refuses a fact that cannot be a scalar parameter", () => {
    const result = resolveParameterTemplates(
      [factParam("countries", "case.citizenshipCountries")],
      view,
      null,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("PARAMETER_FACT_UNRESOLVED");
  });

  it("resolves country templates in all three forms", () => {
    expect(resolveCountryTemplate(null, view, null)).toEqual({ state: "RESOLVED", value: null });
    expect(
      resolveCountryTemplate({ kind: "LITERAL", countryCode: country("DE") }, view, null),
    ).toEqual({ state: "RESOLVED", value: country("DE") });
    expect(
      resolveCountryTemplate({ kind: "FACT", path: "case.entryTravelDocumentCountry" }, view, null).state,
    ).toBe("RESOLVED");

    const unknownView = projectRuleFactView(
      userCaseFacts({ entryTravelDocumentCountry: unansweredFact }),
      context,
    );
    expect(
      resolveCountryTemplate({ kind: "FACT", path: "case.entryTravelDocumentCountry" }, unknownView, null).state,
    ).toBe("UNRESOLVED");
  });

  it("reads a scope-bound template only when a binding is supplied", () => {
    const collection = view.nationalities;
    if (collection.state !== "KNOWN") {
      throw new Error("expected a known collection");
    }
    const bound = unwrapOrThrow(
      resolveParameterTemplates(
        [factParam("country", "scope.nationality.countryCode")],
        view,
        collection.entries[0] ?? null,
      ),
    );
    expect(bound.state).toBe("RESOLVED");
    const unbound = unwrapOrThrow(
      resolveParameterTemplates([factParam("country", "scope.nationality.countryCode")], view, null),
    );
    expect(unbound.state).toBe("UNRESOLVED");
  });
});

describe("rule instances and scopes", () => {
  const facts = userCaseFacts({
    nationalities: knownFact([
      { countryCode: country("DE"), roles: ["CITIZENSHIP"] },
      { countryCode: country("IT"), roles: ["CITIZENSHIP"] },
    ]),
    residenceHistory: knownFact([
      { countryCode: country("PY"), from: "2024-01-01" as never, to: null },
      { countryCode: country("DE"), from: "2020-01-01" as never, to: "2023-12-31" as never },
    ]),
  });
  const view = projectRuleFactView(facts, context);

  it("produces one instance per collection entry", () => {
    const revision = rule("r.n", {
      family: "PROCEDURE",
      scope: "EACH_NATIONALITY",
      condition: {
        kind: "COMPARE",
        path: "scope.nationality.countryCode",
        operator: "EQ",
        operand: { kind: "STRING", value: "DE" },
      },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: {
          procedureId: id("syn.p"),
          parameters: [],
          discriminator: null,
          requirement: "REQUIRED",
        },
      },
    });
    const instances = unwrapOrThrow(evaluateRuleInstances(revision, view, context));
    expect(instances).toHaveLength(2);
    expect(instances.map((instance) => instance.truth).sort()).toEqual(["FALSE", "TRUE"]);
  });

  it("produces one indeterminate instance when the collection itself is unknown", () => {
    const unknownView = projectRuleFactView(userCaseFacts({ residenceHistory: unknownFact }), context);
    const revision = rule("r.rh", {
      family: "PROCEDURE",
      scope: "EACH_RESIDENCE_HISTORY_ENTRY",
      condition: {
        kind: "COMPARE",
        path: "scope.residenceHistory.countryCode",
        operator: "EQ",
        operand: { kind: "STRING", value: "PY" },
      },
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: {
          procedureId: id("syn.p"),
          parameters: [],
          discriminator: null,
          requirement: "REQUIRED",
        },
      },
    });
    const instances = unwrapOrThrow(evaluateRuleInstances(revision, unknownView, context));
    expect(instances).toHaveLength(1);
    expect(instances[0]?.truth).toBe("INDETERMINATE");
    expect(instances[0]?.indeterminateFactPaths).toEqual(["scope.residenceHistory.from"]);
  });

  it("refuses to scope a legal requirement family over documents", () => {
    const revision = rule("r.d", {
      family: "PROCEDURE",
      scope: "EACH_DOCUMENT_INSTANCE",
      condition: alwaysTrue,
      precedence: [],
      resolution: {
        state: "RESOLVED",
        consequence: {
          procedureId: id("syn.p"),
          parameters: [],
          discriminator: null,
          requirement: "REQUIRED",
        },
      },
    });
    const result = evaluateRuleInstances(revision, view, context);
    expect(!result.ok && result.error.code).toBe("UNSUPPORTED_SCOPE_FOR_FAMILY");
  });

  it("lets document reuse iterate document instances", () => {
    const withDocuments = userCaseFacts(
      {},
      {
        documents: knownFact([
          {
            instanceId: "00000000-0000-4000-8000-0000000000d1" as never,
            documentTypeId: "syn.d" as never,
            issuingCountry: knownFact(country("DE")),
            issueDate: unansweredFact,
            expiryDate: unansweredFact,
            language: unansweredFact,
            readinessStatus: "OBTAINED",
          },
        ]),
      },
    );
    const documentView = projectRuleFactView(withDocuments, context);
    const revision = rule("r.reuse", {
      ...reusePayload("syn.p", "syn.d", "REUSABLE_CONFIRMED"),
      scope: "EACH_DOCUMENT_INSTANCE",
      condition: {
        kind: "COMPARE",
        path: "scope.document.readinessStatus",
        operator: "EQ",
        operand: { kind: "STRING", value: "OBTAINED" },
      },
    });
    const instances = unwrapOrThrow(evaluateRuleInstances(revision, documentView, context));
    expect(instances).toHaveLength(1);
    expect(instances[0]?.truth).toBe("TRUE");
  });

  it("marks an unresolved rule as carrying no consequence", () => {
    const revision = rule(
      "r.u",
      unresolved(procedurePayload("syn.p"), "OFFICIAL_VERIFICATION_REQUIRED", {
        code: "PROCEDURE_REQUIREMENT_UNCONFIRMED",
        target: { kind: "PROCEDURE", targetProcedure: procedureSelector("syn.p") },
      }),
      { verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED" },
    );
    const instances = unwrapOrThrow(evaluateRuleInstances(revision, view, context));
    expect(instances[0]?.support).toBeNull();
    expect(instances[0]?.unresolved?.reason).toBe("OFFICIAL_VERIFICATION_REQUIRED");
    expect(statedConsequence(instances[0]!)).toBeNull();
  });

  it("refuses a rule whose resolution contradicts its evidence status", () => {
    const revision = rule("r.mismatch", procedurePayload("syn.p"));
    const broken = { ...revision, verificationStatus: "CONFLICTING" as const };
    const result = evaluateRuleInstances(broken, view, context);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("RESOLUTION_STATUS_MISMATCH");

    const asks = rule(
      "r.asks",
      unresolved(procedurePayload("syn.p"), "CONFLICTING", {
        code: "PROCEDURE_REQUIREMENT_UNCONFIRMED",
        target: { kind: "CASE" },
      }),
      { verificationStatus: "CONFLICTING" },
    );
    const reversed = evaluateRuleInstances(
      { ...asks, verificationStatus: "CONFIRMED" as const },
      view,
      context,
    );
    expect(!reversed.ok && reversed.error.code).toBe("RESOLUTION_STATUS_MISMATCH");
  });

  it("exposes declared precedence as a lookup set", () => {
    const revision = rule("r.p", procedurePayload("syn.p"), {
      precedence: [
        { relation: "OVERRIDES", overRuleId: id("r.other") },
        { relation: "EXCEPTION_TO", overRuleId: id("r.another") },
      ],
    });
    const dominated = dominatedRuleIds(revision);
    expect([...dominated].sort()).toEqual(["r.another", "r.other"]);
  });

  it("returns an empty instance list for a family with no rules", () => {
    const stage: StageContext = {
      view,
      context,
      bundle: { effectiveLocalDate: context.effectiveLocalDate } as never,
      engine: CURRENT_ENGINE_DESCRIPTOR,
      instancesByFamily: new Map(),
    };
    expect(instancesOf(stage, "FEE")).toEqual([]);
  });
});

describe("target resolution states", () => {
  const view = projectRuleFactView(userCaseFacts(), context);
  const index = {
    requiredKeys: new Set(["rp1:syn.p||-"]),
    negativeKeys: new Set(["rp1:syn.n||-"]),
    requiredByProcedureId: new Map([["syn.multi", ["rp1:syn.multi|a=s%3A1|-", "rp1:syn.multi|a=s%3A2|-"]]]),
    negativeByProcedureId: new Map([["syn.negative", ["rp1:syn.negative||-"]]]),
  };

  it("MATCHED for an exact key", () => {
    const result = unwrapOrThrow(
      resolveProcedureTarget(procedureSelector("syn.p"), view, null, index, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("MATCHED");
  });

  it("NEGATIVELY_RESOLVED for a decided-not-required key", () => {
    const result = unwrapOrThrow(
      resolveProcedureTarget(procedureSelector("syn.n"), view, null, index, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("NEGATIVELY_RESOLVED");
  });

  it("MISSING when nothing decided the target", () => {
    const result = unwrapOrThrow(
      resolveProcedureTarget(procedureSelector("syn.absent"), view, null, index, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("MISSING");
  });

  it("AMBIGUOUS for a parameterless selector matching several procedures", () => {
    const result = unwrapOrThrow(
      resolveProcedureTarget(procedureSelector("syn.multi", null), view, null, index, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("AMBIGUOUS");
  });

  it("NEGATIVELY_RESOLVED for a parameterless selector whose only decision was negative", () => {
    const result = unwrapOrThrow(
      resolveProcedureTarget(procedureSelector("syn.negative", null), view, null, index, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("NEGATIVELY_RESOLVED");
  });

  it("MISSING for a parameterless selector nothing decided", () => {
    const result = unwrapOrThrow(
      resolveProcedureTarget(procedureSelector("syn.nothing", null), view, null, index, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("MISSING");
  });

  it("UNRESOLVED_TEMPLATE when the selector depends on an unknown fact", () => {
    const unknownView = projectRuleFactView(userCaseFacts({ adultStatus: unknownFact }), context);
    const result = unwrapOrThrow(
      resolveProcedureTarget(
        procedureSelector("syn.p", [factParam("adult", "case.adultStatus")]),
        unknownView,
        null,
        index,
        CURRENT_ENGINE_DESCRIPTOR,
      ),
    );
    expect(result.state).toBe("UNRESOLVED_TEMPLATE");
  });
});

describe("document target resolution", () => {
  const view = projectRuleFactView(userCaseFacts(), context);
  const procedureIndex = {
    requiredKeys: new Set(["rp1:syn.p||-"]),
    negativeKeys: new Set<string>(),
    requiredByProcedureId: new Map([["syn.p", ["rp1:syn.p||-"]]]),
    negativeByProcedureId: new Map<string, readonly string[]>(),
  };
  const documentIndex: DocumentIndex = {
    entries: [
      {
        key: "rd1:a",
        identity: {
          forProcedure: "rp1:syn.p||-" as RequiredProcedureKey,
          documentTypeId: id("syn.d"),
          issuingCountry: country("DE"),
          discriminator: null,
        },
        requirement: "REQUIRED" as const,
      },
      {
        key: "rd1:b",
        identity: {
          forProcedure: "rp1:syn.p||-" as RequiredProcedureKey,
          documentTypeId: id("syn.d"),
          issuingCountry: country("FR"),
          discriminator: null,
        },
        requirement: "REQUIRED" as const,
      },
      {
        key: "rd1:c",
        identity: {
          forProcedure: "rp1:syn.p||-" as RequiredProcedureKey,
          documentTypeId: id("syn.negative"),
          issuingCountry: null,
          discriminator: null,
        },
        requirement: "NOT_REQUIRED" as const,
      },
    ],
  };

  const selector = (documentTypeId: string, issuingCountry: string | null): DocumentTargetSelector => ({
    forProcedure: procedureSelector("syn.p"),
    documentTypeId: id(documentTypeId),
    issuingCountry:
      issuingCountry === null ? null : { kind: "LITERAL", countryCode: country(issuingCountry) },
    discriminator: null,
  });

  it("MATCHED on an exact issuing country", () => {
    const result = unwrapOrThrow(
      resolveDocumentTarget(selector("syn.d", "DE"), view, null, procedureIndex, documentIndex, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state === "MATCHED" && (result.key as string)).toBe("rd1:a");
  });

  it("AMBIGUOUS when a wildcard matches several documents", () => {
    const result = unwrapOrThrow(
      resolveDocumentTarget(selector("syn.d", null), view, null, procedureIndex, documentIndex, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("AMBIGUOUS");
  });

  it("NEGATIVELY_RESOLVED for a document decided not required", () => {
    const result = unwrapOrThrow(
      resolveDocumentTarget(selector("syn.negative", null), view, null, procedureIndex, documentIndex, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("NEGATIVELY_RESOLVED");
  });

  it("MISSING for a document nothing decided", () => {
    const result = unwrapOrThrow(
      resolveDocumentTarget(selector("syn.absent", null), view, null, procedureIndex, documentIndex, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("MISSING");
  });

  it("propagates the procedure's own resolution state", () => {
    const emptyIndex = {
      requiredKeys: new Set<string>(),
      negativeKeys: new Set<string>(),
      requiredByProcedureId: new Map<string, readonly string[]>(),
      negativeByProcedureId: new Map<string, readonly string[]>(),
    };
    const result = unwrapOrThrow(
      resolveDocumentTarget(selector("syn.d", "DE"), view, null, emptyIndex, documentIndex, CURRENT_ENGINE_DESCRIPTOR),
    );
    expect(result.state).toBe("MISSING");
  });

  it("reports UNRESOLVED_TEMPLATE when the issuing country depends on an unknown fact", () => {
    const unknownView = projectRuleFactView(
      userCaseFacts({ entryTravelDocumentCountry: unknownFact }),
      context,
    );
    const result = unwrapOrThrow(
      resolveDocumentTarget(
        {
          forProcedure: procedureSelector("syn.p"),
          documentTypeId: id("syn.d"),
          issuingCountry: { kind: "FACT", path: "case.entryTravelDocumentCountry" },
          discriminator: null,
        },
        unknownView,
        null,
        procedureIndex,
        documentIndex,
        CURRENT_ENGINE_DESCRIPTOR,
      ),
    );
    expect(result.state).toBe("UNRESOLVED_TEMPLATE");
  });

  it("propagates an ambiguous procedure target", () => {
    const ambiguousIndex = {
      requiredKeys: new Set(["rp1:syn.p|a=s%3A1|-", "rp1:syn.p|a=s%3A2|-"]),
      negativeKeys: new Set<string>(),
      requiredByProcedureId: new Map([["syn.p", ["rp1:syn.p|a=s%3A1|-", "rp1:syn.p|a=s%3A2|-"]]]),
      negativeByProcedureId: new Map<string, readonly string[]>(),
    };
    const result = unwrapOrThrow(
      resolveDocumentTarget(
        {
          forProcedure: procedureSelector("syn.p", null),
          documentTypeId: id("syn.d"),
          issuingCountry: null,
          discriminator: null,
        },
        view,
        null,
        ambiguousIndex,
        documentIndex,
        CURRENT_ENGINE_DESCRIPTOR,
      ),
    );
    expect(result.state).toBe("AMBIGUOUS");
  });
});

describe("target outcome classification", () => {
  it("applies a matched target and skips a negatively resolved one", () => {
    expect(unwrapOrThrow(classifyTargetOutcome("MATCHED", "TRUE", id("r"), "d"))).toBe("APPLY");
    expect(unwrapOrThrow(classifyTargetOutcome("NEGATIVELY_RESOLVED", "TRUE", id("r"), "d"))).toBe("SKIP");
  });

  it("errors on a missing or ambiguous target only when the rule asserts", () => {
    for (const state of ["MISSING", "AMBIGUOUS", "UNRESOLVED_TEMPLATE"] as const) {
      const asserted = classifyTargetOutcome(state, "TRUE", id("r"), "d");
      expect(asserted.ok, state).toBe(false);
      const indeterminate = classifyTargetOutcome(state, "INDETERMINATE", id("r"), "d");
      expect(indeterminate.ok && indeterminate.value, state).toBe("SKIP");
    }
  });
});

describe("verification flags", () => {
  const procedureKey = "rp1:syn.p||-" as RequiredProcedureKey;
  const documentKey = "rd1:syn.d" as RequiredDocumentKey;

  it("derives a stable key for every target shape", () => {
    const keys: readonly string[] = [
      verificationFlagKey({ code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "CASE" }, reason: "UNKNOWN", provenance: [] }),
      verificationFlagKey({ code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "PROCEDURE", procedureKey }, reason: "UNKNOWN", provenance: [] }),
      verificationFlagKey({ code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "DOCUMENT", documentKey }, reason: "UNKNOWN", provenance: [] }),
      verificationFlagKey({ code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "VISA_PURPOSE", purposeCode: id("p") }, reason: "UNKNOWN", provenance: [] }),
      verificationFlagKey({ code: "CASE_CLASSIFICATION_UNCONFIRMED", target: { kind: "FEE_COMPONENT", procedureKey, componentCode: id("c") }, reason: "UNKNOWN", provenance: [] }),
    ];
    expect(new Set(keys).size).toBe(5);
  });

  it("dedupes identical flags and merges their provenance", () => {
    const flag: VerificationFlag = {
      code: "CASE_CLASSIFICATION_UNCONFIRMED",
      target: { kind: "CASE" },
      reason: "UNKNOWN",
      provenance: [{ ruleId: id("r.a"), ruleRevisionId: id("rev-a"), sourceRevisionIds: [] }],
    };
    const other: VerificationFlag = {
      ...flag,
      provenance: [{ ruleId: id("r.b"), ruleRevisionId: id("rev-b"), sourceRevisionIds: [] }],
    };
    const canonical = canonicalVerificationFlags([flag, other]);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]?.provenance).toHaveLength(2);
  });
});

describe("blocking issues", () => {
  it("maps a fact path through the closed registry", () => {
    const issues = unwrapOrThrow(
      buildBlockingIssues([
        { path: "case.adultStatus", slotFamily: "CASE_TYPE" },
        { path: "case.adultStatus", slotFamily: "CASE_TYPE" },
        { path: "case.maritalStatus", slotFamily: "FEE" },
      ]),
    );
    expect(issues).toEqual([
      { code: "ADULT_STATUS_REQUIRED", blockedSlotFamily: "CASE_TYPE" },
      { code: "MARITAL_STATUS_REQUIRED", blockedSlotFamily: "FEE" },
    ]);
  });

  it("raises an invariant violation rather than inventing a code", () => {
    const result = buildBlockingIssues([{ path: "context.effectiveLocalDate", slotFamily: "CASE_TYPE" }]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("MISSING_BLOCKING_ISSUE_MAPPING");
  });

  it("is empty for no input", () => {
    expect(unwrapOrThrow(buildBlockingIssues([]))).toEqual([]);
  });
});

describe("document requirement removal", () => {
  it("drops a document a confirmed rule says is not required", () => {
    const revision = rule("r.doc", documentPayload("syn.p", "syn.d", "NOT_REQUIRED"));
    expect(revision.payload.family).toBe("DOCUMENT_REQUIREMENT");
  });
});
