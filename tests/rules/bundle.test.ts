import { beforeEach, describe, expect, it } from "vitest";
import {
  bundleContent,
  feeIndexRevision,
  firstCedulaPolicy,
  pathway,
  resetRuleCounter,
  rule,
  supportedCoverage,
  testSourceRevision,
} from "../fixtures/rules";
import { caseTypePayload, procedurePayload } from "../fixtures/payloads";
import { canonicalizeBundleContent, evaluationBundleContentHash } from "../../src/rules/bundle/canonical-bundle";
import { prepareEngineReadyBundle } from "../../src/rules/bundle/engine-ready-bundle";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../src/domain/evaluation/engine-descriptor";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { id } from "../fixtures/ids";

const on = "2026-06-15" as LocalDate;

beforeEach(() => {
  resetRuleCounter();
});

describe("bundle content hash", () => {
  it("is the same for the same content", () => {
    resetRuleCounter();
    const a = bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))]);
    resetRuleCounter();
    const b = bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))]);
    expect(evaluationBundleContentHash(a)).toBe(evaluationBundleContentHash(b));
  });

  it("is independent of array order", () => {
    resetRuleCounter();
    const first = rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
    const second = rule("r.b", procedurePayload("synthetic.p"));
    expect(evaluationBundleContentHash(bundleContent([first, second]))).toBe(
      evaluationBundleContentHash(bundleContent([second, first])),
    );
  });

  it("does not depend on when the bundle was first materialised", () => {
    // firstMaterializedAt lives on the record, not the content, so it cannot
    // be part of the hash by construction. Canonicalisation proves it: two
    // records built from the same content produce identical canonical JSON.
    resetRuleCounter();
    const content = bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))]);
    expect(canonicalizeBundleContent(content)).toEqual(canonicalizeBundleContent({ ...content }));
    expect(Object.keys(canonicalizeBundleContent(content))).not.toContain("firstMaterializedAt");
  });

  it("changes when a rule revision changes", () => {
    resetRuleCounter();
    const a = bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))]);
    resetRuleCounter();
    const b = bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_TEMPORAL"))]);
    expect(evaluationBundleContentHash(a)).not.toBe(evaluationBundleContentHash(b));
  });

  it("changes when a product policy changes", () => {
    resetRuleCounter();
    const rules = [rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))];
    const withPolicy = bundleContent(rules, { productPolicyRevisions: [firstCedulaPolicy()] });
    const withoutPolicy = bundleContent(rules, {});
    expect(evaluationBundleContentHash(withPolicy)).not.toBe(evaluationBundleContentHash(withoutPolicy));
  });

  it("changes when a pathway definition changes", () => {
    resetRuleCounter();
    const rules = [rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))];
    const one = bundleContent(rules, { pathwayDefinitionRevisions: [pathway("a", ["SPECIAL_CASE"])] });
    resetRuleCounter();
    const two = bundleContent(rules, { pathwayDefinitionRevisions: [pathway("b", ["SPECIAL_CASE"])] });
    expect(evaluationBundleContentHash(one)).not.toBe(evaluationBundleContentHash(two));
  });

  it("changes when a coverage revision changes", () => {
    resetRuleCounter();
    const rules = [rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))];
    const one = bundleContent(rules, { productCoverageRevisions: [supportedCoverage("DE")] });
    resetRuleCounter();
    const two = bundleContent(rules, { productCoverageRevisions: [supportedCoverage("DE", "PARTIAL")] });
    expect(evaluationBundleContentHash(one)).not.toBe(evaluationBundleContentHash(two));
  });
});

describe("engine-ready bundle preparation", () => {
  it("carries the effective date it was assembled for", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(prepared.ok && (prepared.value.effectiveLocalDate as string)).toBe("2026-06-15");
  });

  it("rejects a rule that is not published", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), { publicationStatus: "DRAFT" }),
      ]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(prepared.ok).toBe(false);
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "INELIGIBLE_PUBLICATION_STATUS")).toBe(true);
  });

  it("accepts a superseded rule whose window still covers the evaluation date", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), {
          publicationStatus: "SUPERSEDED",
          validUntil: "2026-12-31" as LocalDate,
        }),
      ]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(prepared.ok).toBe(true);
  });

  it("rejects a rule outside its effective window", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), {
          validFrom: "2027-01-01" as LocalDate,
        }),
      ]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "RULE_OUTSIDE_EFFECTIVE_WINDOW")).toBe(true);
  });

  it("rejects two effective revisions of the same rule", () => {
    resetRuleCounter();
    const prepared = prepareEngineReadyBundle(
      bundleContent([
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_TEMPORAL")),
      ]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "DUPLICATE_RULE_IDENTITY")).toBe(true);
  });

  it("rejects evidence that is not part of the bundle", () => {
    const revision = rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
    const prepared = prepareEngineReadyBundle(
      { ...bundleContent([revision]), evidence: [] },
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "MISSING_EVIDENCE_SOURCE_REVISION")).toBe(true);
  });

  it("rejects overlapping fee index revisions instead of tie-breaking at runtime", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], {
        feeIndexRevisions: [feeIndexRevision("synthetic.jornal", 1), feeIndexRevision("synthetic.jornal", 2)],
      }),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "OVERLAPPING_FEE_INDEX_REVISIONS")).toBe(true);
  });

  it("rejects an unsupported bundle schema version", () => {
    const prepared = prepareEngineReadyBundle(
      { ...bundleContent([]), schemaVersion: "evaluation-bundle@9.9" as never },
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "UNSUPPORTED_BUNDLE_SCHEMA_VERSION")).toBe(true);
  });

  it("rejects an unsupported rule payload schema version", () => {
    const revision = rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
    const prepared = prepareEngineReadyBundle(
      bundleContent([{ ...revision, payloadSchemaVersion: "rule-payload@9.9" as never }]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "BUNDLE" && issue.code === "UNSUPPORTED_RULE_PAYLOAD_VERSION")).toBe(true);
  });

  it("indexes evidence and rules for the engine", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"))], {
        evidence: [testSourceRevision()],
      }),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(prepared.ok && prepared.value.ruleRevisionByRuleId.has("r.a")).toBe(true);
    expect(prepared.ok && prepared.value.evidenceBySourceRevisionId.size).toBe(1);
    expect(prepared.ok && String(prepared.value.contentHash)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("propagates structural rule issues", () => {
    const revision = rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
    const prepared = prepareEngineReadyBundle(
      bundleContent([{ ...revision, evidence: [] }], { evidence: [] }),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "RULE")).toBe(true);
  });

  it("propagates precedence issues", () => {
    const prepared = prepareEngineReadyBundle(
      bundleContent([
        rule("r.a", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), {
          precedence: [{ relation: "OVERRIDES", overRuleId: id("r.missing") }],
        }),
      ]),
      on,
      CURRENT_ENGINE_DESCRIPTOR,
    );
    expect(!prepared.ok && prepared.error.some((issue) => issue.kind === "PRECEDENCE")).toBe(true);
  });
});
