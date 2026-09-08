import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PROPERTY_SEEDS, RUNS_PER_SEED } from "./seeds";
import { userCaseFacts, country, noSpecialCase, unansweredSpecialCase } from "../fixtures/facts";
import { firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import {
  caseTypePayload,
  documentPayload,
  feePayload,
  literalParam,
  procedurePayload,
  warningPayload,
} from "../fixtures/payloads";
import { runEngine } from "../fixtures/engine";
import { knownFact, unansweredFact, unknownFact } from "../../src/domain/case/knowledge";
import { canonicalProvenance } from "../../src/case-engine/canonicalization/ordering";
import { makeRequiredProcedureKey } from "../../src/case-engine/canonicalization/keys";
import { CURRENT_DERIVED_KEY_FORMAT_VERSION } from "../../src/domain/evaluation/engine-descriptor";
import { canonicalJsonStringify } from "../../src/shared/serialization/canonical-json";
import { topologicalOrder } from "../../src/case-engine/graph/dependency-stage";
import type { RequiredProcedure, RequiredProcedureDependency } from "../../src/domain/procedures/procedure";
import { unwrapOrThrow } from "../../src/shared/result/result";
import { id } from "../fixtures/ids";
import type { ProvenanceRef } from "../../src/domain/evaluation/provenance";

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [
    pathway("standard", [
      "STANDARD_FIRST_CEDULA_FROM_NONE",
      "SPECIAL_CASE",
      "COUNTRY_NOT_SUPPORTED",
      "NOT_FIRST_CEDULA",
    ]),
  ],
};

function buildRules() {
  resetRuleCounter();
  return [
    rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE")),
    rule("r.p1", procedurePayload("syn.a", "REQUIRED", { kind: "CONSTANT", value: "TRUE" }, [literalParam("country", "DE")])),
    rule("r.p1-dup", procedurePayload("syn.a", "REQUIRED", { kind: "CONSTANT", value: "TRUE" }, [literalParam("country", "DE")])),
    rule("r.p2", procedurePayload("syn.b")),
    rule("r.doc", documentPayload("syn.b", "syn.doc")),
    rule("r.fee", feePayload("syn.b", "syn.official", { kind: "FIXED", amount: { amountMinorUnits: 8500, currency: id("PYG") } })),
    rule("r.warn", warningPayload("FEE_MAY_CHANGE", "INFO", null)),
  ];
}

const factsArbitrary = fc.record({
  adult: fc.constantFrom("ADULT", "MINOR", "UNKNOWN"),
  marital: fc.constantFrom("SINGLE", "MARRIED", "UNANSWERED"),
  citizenships: fc.subarray(["DE", "FR", "IT"], { minLength: 1 }),
  special: fc.boolean(),
});

function makeFacts(input: { adult: string; marital: string; citizenships: string[]; special: boolean }) {
  return userCaseFacts({
    adultStatus: input.adult === "UNKNOWN" ? unknownFact : knownFact(input.adult as "ADULT" | "MINOR"),
    maritalStatus: input.marital === "UNANSWERED" ? unansweredFact : knownFact(input.marital as "SINGLE" | "MARRIED"),
    nationalities: knownFact(
      input.citizenships.map((code) => ({ countryCode: country(code), roles: ["CITIZENSHIP" as const] })),
    ),
    processTravelDocumentCountry: knownFact(country("DE")),
    specialCase: input.special ? unansweredSpecialCase : noSpecialCase,
  });
}

function assertProperty(property: fc.IProperty<unknown> | fc.IAsyncProperty<unknown>): void {
  for (const seed of PROPERTY_SEEDS) {
    fc.assert(property as fc.IProperty<unknown>, { seed, numRuns: RUNS_PER_SEED });
  }
}

describe("engine properties", () => {
  it("is deterministic for identical inputs", () => {
    assertProperty(
      fc.property(factsArbitrary, (input) => {
        const facts = makeFacts(input);
        const first = runEngine(facts, buildRules(), extras);
        const second = runEngine(facts, buildRules(), extras);
        expect(second).toEqual(first);
      }),
    );
  });

  it("is invariant under rule array permutation", () => {
    assertProperty(
      fc.property(factsArbitrary, fc.integer({ min: 0, max: 5039 }), (input, shuffleSeed) => {
        const facts = makeFacts(input);
        const baseline = runEngine(facts, buildRules(), extras);
        const rules = buildRules();
        // Deterministic permutation derived from the generated seed.
        const permuted = [...rules];
        let n = shuffleSeed;
        for (let i = permuted.length - 1; i > 0; i -= 1) {
          const j = n % (i + 1);
          n = Math.floor(n / (i + 1));
          const tmp = permuted[i] as (typeof permuted)[number];
          permuted[i] = permuted[j] as (typeof permuted)[number];
          permuted[j] = tmp;
        }
        expect(runEngine(facts, permuted, extras)).toEqual(baseline);
      }),
    );
  });

  it("deduplicates procedures stated twice", () => {
    assertProperty(
      fc.property(factsArbitrary, (input) => {
        const decision = runEngine(makeFacts(input), buildRules(), extras);
        if (!decision.ok) {
          return;
        }
        const keys = decision.value.requiredProcedures.map((procedure) => procedure.key as string);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it("emits canonically ordered output arrays", () => {
    assertProperty(
      fc.property(factsArbitrary, (input) => {
        const decision = runEngine(makeFacts(input), buildRules(), extras);
        if (!decision.ok) {
          return;
        }
        const value = decision.value;
        const sorted = <T>(items: readonly T[], key: (item: T) => string) =>
          [...items].map(key).every((entry, index, all) => index === 0 || (all[index - 1] as string) <= entry);
        expect(sorted(value.requiredProcedures, (p) => p.key as string)).toBe(true);
        expect(sorted(value.requiredDocuments, (d) => d.key as string)).toBe(true);
        expect(sorted(value.documentReuseAssessments, (d) => d.documentKey as string)).toBe(true);
        expect(sorted(value.modifiers, (m) => `${m.code}|${m.qualifier ?? "-"}`)).toBe(true);
        for (const procedure of value.requiredProcedures) {
          // Provenance is ordered by the (ruleId, ruleRevisionId) tuple, not by
          // a joined string: joining would let a separator character collate
          // "r.p1-dup" before "r.p1".
          const pairs = procedure.provenance.map((p) => [p.ruleId as string, p.ruleRevisionId as string] as const);
          const isOrdered = pairs.every((pair, index) => {
            if (index === 0) {
              return true;
            }
            const previous = pairs[index - 1] as readonly [string, string];
            return previous[0] < pair[0] || (previous[0] === pair[0] && previous[1] <= pair[1]);
          });
          expect(isOrdered).toBe(true);
        }
      }),
    );
  });

  it("canonical JSON of a decision is idempotent", () => {
    assertProperty(
      fc.property(factsArbitrary, (input) => {
        const decision = runEngine(makeFacts(input), buildRules(), extras);
        if (!decision.ok) {
          return;
        }
        const once = canonicalJsonStringify(decision.value);
        const twice = canonicalJsonStringify(JSON.parse(once));
        expect(twice).toBe(once);
      }),
    );
  });
});

describe("derived key properties", () => {
  const parameterArbitrary = fc.array(
    fc.record({
      name: fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,8}$/u),
      value: fc.string({ minLength: 1, maxLength: 12 }),
    }),
    { maxLength: 5 },
  );

  it("is stable under parameter reordering", () => {
    assertProperty(
      fc.property(parameterArbitrary, (parameters) => {
        const unique = [...new Map(parameters.map((p) => [p.name, p])).values()];
        const build = (list: typeof unique) =>
          unwrapOrThrow(
            makeRequiredProcedureKey(
              {
                procedureId: id("syn.p"),
                parameters: list.map((p) => ({ name: p.name, value: { kind: "STRING" as const, value: p.value } })),
                discriminator: null,
              },
              CURRENT_DERIVED_KEY_FORMAT_VERSION,
            ),
          );
        expect(build([...unique].reverse())).toBe(build(unique));
      }),
    );
  });

  it("distinguishes different content", () => {
    assertProperty(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ minLength: 1, maxLength: 10 }), (a, b) => {
        fc.pre(a !== b);
        const build = (value: string) =>
          unwrapOrThrow(
            makeRequiredProcedureKey(
              {
                procedureId: id("syn.p"),
                parameters: [{ name: "x", value: { kind: "STRING", value } }],
                discriminator: null,
              },
              CURRENT_DERIVED_KEY_FORMAT_VERSION,
            ),
          );
        expect(build(a)).not.toBe(build(b));
      }),
    );
  });
});

describe("provenance canonicalisation", () => {
  it("dedupes by revision, sorts, and is idempotent", () => {
    const refArbitrary = fc.record({
      ruleId: fc.stringMatching(/^[a-z]{1,6}$/u),
      revision: fc.integer({ min: 1, max: 5 }),
      sources: fc.array(fc.integer({ min: 1, max: 5 }), { maxLength: 4 }),
    });
    assertProperty(
      fc.property(fc.array(refArbitrary, { maxLength: 8 }), (refs) => {
        const provenance: ProvenanceRef[] = refs.map((ref) => ({
          ruleId: id(ref.ruleId),
          ruleRevisionId: id(`00000000-0000-4000-8000-00000000000${ref.revision}`),
          sourceRevisionIds: ref.sources.map((source) => id(`00000000-0000-4000-8000-00000000010${source}`)),
        }));
        const once = canonicalProvenance(provenance);
        expect(canonicalProvenance([...once].reverse())).toEqual(once);
        const revisionIds = once.map((entry) => entry.ruleRevisionId as string);
        expect(new Set(revisionIds).size).toBe(revisionIds.length);
        expect([...revisionIds]).toEqual([...revisionIds]);
      }),
    );
  });
});

describe("dependency DAG properties", () => {
  it("produces an order in which every prerequisite comes first", () => {
    assertProperty(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 })), { maxLength: 8 }),
        (count, rawEdges) => {
          const procedures: RequiredProcedure[] = Array.from({ length: count }, (_, index) => ({
            key: `rp1:p${index}` as RequiredProcedure["key"],
            identity: { procedureId: id(`p${index}`), parameters: [], discriminator: null },
            support: "CONFIRMED",
            provenance: [],
          }));
          // Only forward edges, which guarantees acyclicity by construction.
          const edges: RequiredProcedureDependency[] = rawEdges
            .filter(([a, b]) => a < b && b < count)
            .map(([a, b]) => ({
              dependent: `rp1:p${b}` as RequiredProcedureDependency["dependent"],
              dependsOn: `rp1:p${a}` as RequiredProcedureDependency["dependsOn"],
              support: "CONFIRMED",
              provenance: [],
            }));
          const order = topologicalOrder(procedures, edges);
          expect(order.ok).toBe(true);
          if (!order.ok) {
            return;
          }
          const position = new Map(order.value.map((key, index) => [key, index]));
          for (const edge of edges) {
            expect(position.get(edge.dependsOn as string)).toBeLessThan(
              position.get(edge.dependent as string) as number,
            );
          }
        },
      ),
    );
  });
});
