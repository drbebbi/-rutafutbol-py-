import { beforeEach, describe, expect, it } from "vitest";
import { evaluateCaseForUser } from "../../src/application/evaluations/evaluate-case-service";
import type {
  CaseEvaluationRepositoryPort,
  EvaluationBundleStorePort,
  KnowledgeReadPort,
  RecordEvaluationInput,
} from "../../src/application/ports/ports";
import { bundleContent, firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import { caseTypePayload, procedurePayload } from "../fixtures/payloads";
import { userCaseFacts } from "../fixtures/facts";
import { DEFAULT_INSTANT } from "../fixtures/engine";
import type { EvaluationBundleId, UserCaseId } from "../../src/domain/identifiers/identifiers";
import { sha256HexConstant } from "../../src/domain/primitives/hash";
import { evaluationBundleContentHash } from "../../src/rules/bundle/canonical-bundle";

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

function dependencies(recorded: RecordEvaluationInput[]) {
  resetRuleCounter();
  const content = bundleContent(
    [
      rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
      rule("r.proc", procedurePayload("syn.p")),
    ],
    extras,
  );
  const knowledge: KnowledgeReadPort = {
    loadBundleContentFor: () => Promise.resolve({ ok: true, value: content }),
  };
  const bundleStore: EvaluationBundleStorePort = {
    materialize: () =>
      Promise.resolve({ ok: true, value: "00000000-0000-4000-8000-0000000000b1" as EvaluationBundleId }),
  };
  const evaluations: CaseEvaluationRepositoryPort = {
    record: (input) => {
      recorded.push(input);
      return Promise.resolve({ ok: true, value: "00000000-0000-4000-8000-0000000000e1" as never });
    },
    listForCase: () => Promise.resolve({ ok: true, value: [] }),
  };
  return {
    content,
    deps: {
      clock: { nowInstant: () => DEFAULT_INSTANT },
      hash: { canonicalHash: () => sha256HexConstant("a".repeat(64)) },
      knowledge,
      bundleStore,
      evaluations,
    },
  };
}

beforeEach(() => {
  resetRuleCounter();
});

describe("evaluate case service", () => {
  it("evaluates without persisting anything for an anonymous visitor", async () => {
    const recorded: RecordEvaluationInput[] = [];
    const { deps, content } = dependencies(recorded);
    const result = await evaluateCaseForUser(userCaseFacts(), deps, null);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.decision.caseClassification.status).toBe("COMPLETE");
    expect(result.value.storedEvaluationId).toBeNull();
    expect(recorded).toHaveLength(0);
    expect(result.value.bundleContentHash).toBe(evaluationBundleContentHash(content) as string);
  });

  it("persists the effective local date it actually used", async () => {
    const recorded: RecordEvaluationInput[] = [];
    const { deps } = dependencies(recorded);
    const caseId = "00000000-0000-4000-8000-0000000000c1" as UserCaseId;
    const result = await evaluateCaseForUser(userCaseFacts(), deps, caseId);
    expect(result.ok).toBe(true);
    expect(recorded).toHaveLength(1);
    const input = recorded[0] as RecordEvaluationInput;
    expect(input.effectiveLocalDate as string).toBe("2026-06-15");
    expect(input.jurisdictionTimeZone).toBe("America/Asuncion");
    expect(input.engineVersion).toBe("1.0.0");
    expect(input.evaluationBundleId as string).toBe("00000000-0000-4000-8000-0000000000b1");
  });

  it("surfaces a knowledge port failure without inventing a decision", async () => {
    const recorded: RecordEvaluationInput[] = [];
    const { deps } = dependencies(recorded);
    const failing = {
      ...deps,
      knowledge: {
        loadBundleContentFor: () =>
          Promise.resolve({
            ok: false as const,
            error: { kind: "PORT_ERROR" as const, code: "UNAVAILABLE" as const, detail: "down" },
          }),
      },
    };
    const result = await evaluateCaseForUser(userCaseFacts(), failing, null);
    expect(!result.ok && result.error.kind).toBe("PORT");
  });

  it("surfaces a bundle validation failure rather than evaluating a broken bundle", async () => {
    const recorded: RecordEvaluationInput[] = [];
    const { deps } = dependencies(recorded);
    resetRuleCounter();
    const broken = bundleContent(
      [rule("r.draft", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"), { publicationStatus: "DRAFT" })],
      extras,
    );
    const result = await evaluateCaseForUser(
      userCaseFacts(),
      { ...deps, knowledge: { loadBundleContentFor: () => Promise.resolve({ ok: true, value: broken }) } },
      null,
    );
    expect(!result.ok && result.error.kind).toBe("BUNDLE");
  });
});
