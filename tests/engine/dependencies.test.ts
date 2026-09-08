import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import { firstCedulaPolicy, pathway, resetRuleCounter, rule, supportedCoverage } from "../fixtures/rules";
import { caseTypePayload, dependencyPayload, procedurePayload } from "../fixtures/payloads";
import { expectErr, expectOk, runEngine } from "../fixtures/engine";
import { topologicalOrder } from "../../src/case-engine/graph/dependency-stage";
import type { RequiredProcedure, RequiredProcedureDependency } from "../../src/domain/procedures/procedure";
import { unwrapOrThrow } from "../../src/shared/result/result";

const extras = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

const caseTypeRule = () => rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));

function procedure(key: string): RequiredProcedure {
  return {
    key: key as RequiredProcedure["key"],
    identity: { procedureId: key as never, parameters: [], discriminator: null },
    support: "CONFIRMED",
    provenance: [],
  };
}

function edge(dependent: string, dependsOn: string): RequiredProcedureDependency {
  return {
    dependent: dependent as RequiredProcedureDependency["dependent"],
    dependsOn: dependsOn as RequiredProcedureDependency["dependsOn"],
    support: "CONFIRMED",
    provenance: [],
  };
}

beforeEach(() => {
  resetRuleCounter();
});

describe("dependency DAG", () => {
  it("orders a single node", () => {
    expect(unwrapOrThrow(topologicalOrder([procedure("a")], []))).toEqual(["a"]);
  });

  it("orders a chain", () => {
    const order = unwrapOrThrow(
      topologicalOrder([procedure("a"), procedure("b"), procedure("c")], [edge("c", "b"), edge("b", "a")]),
    );
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("breaks ties lexically so parallel branches are reproducible", () => {
    const order = unwrapOrThrow(
      topologicalOrder([procedure("z"), procedure("m"), procedure("a")], []),
    );
    expect(order).toEqual(["a", "m", "z"]);
  });

  it("handles a diamond", () => {
    const order = unwrapOrThrow(
      topologicalOrder(
        [procedure("a"), procedure("b"), procedure("c"), procedure("d")],
        [edge("b", "a"), edge("c", "a"), edge("d", "b"), edge("d", "c")],
      ),
    );
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("is unaffected by a duplicate edge", () => {
    const order = unwrapOrThrow(
      topologicalOrder([procedure("a"), procedure("b")], [edge("b", "a"), edge("b", "a")]),
    );
    expect(order).toEqual(["a", "b"]);
  });

  it("rejects a self loop", () => {
    const result = topologicalOrder([procedure("a")], [edge("a", "a")]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("DEPENDENCY_SELF_LOOP");
  });

  it("rejects a two-cycle", () => {
    const result = topologicalOrder([procedure("a"), procedure("b")], [edge("a", "b"), edge("b", "a")]);
    expect(!result.ok && result.error.code).toBe("DEPENDENCY_CYCLE");
  });

  it("rejects a three-cycle", () => {
    const result = topologicalOrder(
      [procedure("a"), procedure("b"), procedure("c")],
      [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    );
    expect(!result.ok && result.error.code).toBe("DEPENDENCY_CYCLE");
  });

  it("ignores dependencies between procedures that are not both required", () => {
    expect(unwrapOrThrow(topologicalOrder([procedure("a")], [edge("a", "not-required")]))).toEqual(["a"]);
  });
});

describe("dependency rules end to end", () => {
  it("records a REQUIRED_BEFORE dependency", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("synthetic.first")),
          rule("r.p2", procedurePayload("synthetic.second")),
          rule("r.dep", dependencyPayload("synthetic.second", "synthetic.first")),
        ],
        extras,
      ),
    );
    expect(decision.procedureDependencies).toHaveLength(1);
    expect(String(decision.procedureDependencies[0]?.dependsOn)).toContain("synthetic.first");
  });

  it("drops a NOT_REQUIRED_BEFORE dependency", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("synthetic.first")),
          rule("r.p2", procedurePayload("synthetic.second")),
          rule("r.dep", dependencyPayload("synthetic.second", "synthetic.first", "NOT_REQUIRED_BEFORE")),
        ],
        extras,
      ),
    );
    expect(decision.procedureDependencies).toEqual([]);
  });

  it("rejects a self-dependency stated by a rule", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("synthetic.first")),
          rule("r.dep", dependencyPayload("synthetic.first", "synthetic.first")),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("DEPENDENCY_SELF_LOOP");
  });

  it("rejects a cycle produced by two dependency rules", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("synthetic.first")),
          rule("r.p2", procedurePayload("synthetic.second")),
          rule("r.dep1", dependencyPayload("synthetic.second", "synthetic.first")),
          rule("r.dep2", dependencyPayload("synthetic.first", "synthetic.second")),
        ],
        extras,
      ),
    );
    expect(error.code).toBe("DEPENDENCY_CYCLE");
  });
});

describe("pathway presentation", () => {
  it("rejects a pathway that shows a procedure before its prerequisite", () => {
    const badPathway = pathway("bad", ["STANDARD_FIRST_CEDULA_FROM_NONE"], [
      { sectionKey: "first", order: 1, procedureKeyPatterns: ["rp1:synthetic.second"] },
      { sectionKey: "second", order: 2, procedureKeyPatterns: ["rp1:synthetic.first"] },
    ]);
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("synthetic.first")),
          rule("r.p2", procedurePayload("synthetic.second")),
          rule("r.dep", dependencyPayload("synthetic.second", "synthetic.first")),
        ],
        { ...extras, pathwayDefinitionRevisions: [badPathway] },
      ),
    );
    expect(error.code).toBe("PATHWAY_VIOLATES_DEPENDENCIES");
  });

  it("accepts a pathway consistent with the dependency order", () => {
    const goodPathway = pathway("good", ["STANDARD_FIRST_CEDULA_FROM_NONE"], [
      { sectionKey: "first", order: 1, procedureKeyPatterns: ["rp1:synthetic.first"] },
      { sectionKey: "second", order: 2, procedureKeyPatterns: ["rp1:synthetic.second"] },
    ]);
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p1", procedurePayload("synthetic.first")),
          rule("r.p2", procedurePayload("synthetic.second")),
          rule("r.dep", dependencyPayload("synthetic.second", "synthetic.first")),
        ],
        { ...extras, pathwayDefinitionRevisions: [goodPathway] },
      ),
    );
    expect(String(decision.applicablePathway)).toBe("good");
  });

  it("requires exactly one pathway for a complete case", () => {
    const missing = expectErr(
      runEngine(userCaseFacts(), [caseTypeRule()], { ...extras, pathwayDefinitionRevisions: [] }),
    );
    expect(missing.code).toBe("PATHWAY_MISSING");

    const ambiguous = expectErr(
      runEngine(userCaseFacts(), [caseTypeRule()], {
        ...extras,
        pathwayDefinitionRevisions: [
          pathway("one", ["STANDARD_FIRST_CEDULA_FROM_NONE"]),
          pathway("two", ["STANDARD_FIRST_CEDULA_FROM_NONE"]),
        ],
      }),
    );
    expect(ambiguous.code).toBe("PATHWAY_AMBIGUOUS");
  });

  it("does not select a pathway while the case is still incomplete", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.unresolved", procedurePayload("synthetic.first"), {
            verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED",
            verification: { code: "PROCEDURE_REQUIREMENT_UNCONFIRMED", targetKind: "CASE" },
          }),
        ],
        extras,
      ),
    );
    expect(decision.applicablePathway).toBeNull();
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
  });
});
