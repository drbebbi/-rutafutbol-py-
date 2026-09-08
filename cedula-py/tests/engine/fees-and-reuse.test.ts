import { beforeEach, describe, expect, it } from "vitest";
import { userCaseFacts } from "../fixtures/facts";
import {
  feeIndexRevision,
  firstCedulaPolicy,
  pathway,
  resetRuleCounter,
  rule,
  supportedCoverage,
} from "../fixtures/rules";
import { caseTypePayload, documentPayload, feePayload, procedurePayload, reusePayload } from "../fixtures/payloads";
import { expectErr, expectOk, runEngine } from "../fixtures/engine";
import { resolveFeeIndex } from "../../src/case-engine/fees/fee-stage";
import { buildCostEstimate } from "../../src/case-engine/fees/cost-estimate";
import type { FeeCalculation } from "../../src/domain/fees/fee";
import type { LocalDate } from "../../src/domain/primitives/local-date";
import { currencyCodeConstant } from "../../src/domain/primitives/money";
import { id } from "../fixtures/ids";

const base = {
  productPolicyRevisions: [firstCedulaPolicy()],
  productCoverageRevisions: [supportedCoverage("DE")],
  pathwayDefinitionRevisions: [pathway("standard", ["STANDARD_FIRST_CEDULA_FROM_NONE"])],
};

const caseTypeRule = () => rule("r.casetype", caseTypePayload("STANDARD_FIRST_CEDULA_FROM_NONE"));
const money = (amount: number, currency = "PYG") => ({
  amountMinorUnits: amount,
  currency: currencyCodeConstant(currency),
});

beforeEach(() => {
  resetRuleCounter();
});

describe("fee calculation", () => {
  it("resolves a fixed amount", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule("r.fee", feePayload("synthetic.p", "synthetic.official", { kind: "FIXED", amount: money(8500) })),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations[0]?.calculatedAmount).toEqual(money(8500));
    expect(decision.costEstimate.confirmedOfficial).toEqual([{ currency: "PYG", amountMinorUnits: 8500 }]);
  });

  it("multiplies an indexed amount by its index unit", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule(
            "r.fee",
            feePayload("synthetic.p", "synthetic.official", {
              kind: "INDEXED",
              multiplier: 25,
              feeIndexId: id("synthetic.jornal"),
            }),
          ),
        ],
        { ...base, feeIndexRevisions: [feeIndexRevision("synthetic.jornal", 117077)] },
      ),
    );
    expect(decision.feeCalculations[0]?.calculatedAmount).toEqual(money(2926925));
    expect(decision.costEstimate.indexedOfficial).toEqual([{ currency: "PYG", amountMinorUnits: 2926925 }]);
  });

  it("leaves an external or variable cost unpriced and lists its code", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule(
            "r.fee",
            feePayload("synthetic.p", "synthetic.translation", {
              kind: "EXTERNAL_VARIABLE",
              costCode: id("synthetic.sworn-translation"),
            }),
          ),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations[0]?.calculatedAmount).toBeNull();
    expect(decision.feeCalculations[0]?.unresolvedReason).toBe("EXTERNAL_OR_VARIABLE");
    expect(decision.costEstimate.externalVariableCostCodes.map(String)).toEqual(["synthetic.sworn-translation"]);
  });

  it("never guesses when the index is missing", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule(
            "r.fee",
            feePayload("synthetic.p", "synthetic.official", {
              kind: "INDEXED",
              multiplier: 25,
              feeIndexId: id("synthetic.jornal"),
            }),
          ),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations[0]?.calculatedAmount).toBeNull();
    expect(decision.feeCalculations[0]?.unresolvedReason).toBe("FEE_INDEX_MISSING");
    expect(decision.costEstimate.unknownOfficialFeeCount).toBe(1);
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("FEE_AMOUNT_UNCONFIRMED");
  });

  it("reports ambiguity rather than picking a revision", () => {
    const overlapping = [
      feeIndexRevision("synthetic.jornal", 100),
      feeIndexRevision("synthetic.jornal", 200),
    ];
    const result = resolveFeeIndex(overlapping, "synthetic.jornal", "2026-06-15" as LocalDate);
    expect(result.state === "UNRESOLVED" && result.reason).toBe("FEE_INDEX_AMBIGUOUS");
  });

  it("refuses an index whose own verification is unresolved", () => {
    const result = resolveFeeIndex(
      [feeIndexRevision("synthetic.jornal", 100, { verificationStatus: "CONFLICTING" })],
      "synthetic.jornal",
      "2026-06-15" as LocalDate,
    );
    expect(result.state === "UNRESOLVED" && result.reason).toBe("FEE_INDEX_UNRESOLVED_VERIFICATION");
  });

  it("respects the index effective window", () => {
    const revisions = [
      feeIndexRevision("synthetic.jornal", 100, { validFrom: "2000-01-01" as LocalDate, validUntil: "2026-01-01" as LocalDate }),
      feeIndexRevision("synthetic.jornal", 200, { validFrom: "2026-01-02" as LocalDate }),
    ];
    const result = resolveFeeIndex(revisions, "synthetic.jornal", "2026-06-15" as LocalDate);
    expect(result.state === "RESOLVED" && result.unitAmount.amountMinorUnits).toBe(200);
  });

  it("downgrades support to STRONG_EVIDENCE when the index is only strong evidence", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule(
            "r.fee",
            feePayload("synthetic.p", "synthetic.official", {
              kind: "INDEXED",
              multiplier: 2,
              feeIndexId: id("synthetic.jornal"),
            }),
          ),
        ],
        {
          ...base,
          feeIndexRevisions: [feeIndexRevision("synthetic.jornal", 10, { verificationStatus: "STRONG_EVIDENCE" })],
        },
      ),
    );
    expect(decision.feeCalculations[0]?.support).toBe("STRONG_EVIDENCE");
  });

  it("refuses to overflow rather than reporting a wrong amount", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule(
            "r.fee",
            feePayload("synthetic.p", "synthetic.official", {
              kind: "INDEXED",
              multiplier: 1000000,
              feeIndexId: id("synthetic.jornal"),
            }),
          ),
        ],
        { ...base, feeIndexRevisions: [feeIndexRevision("synthetic.jornal", Number.MAX_SAFE_INTEGER)] },
      ),
    );
    expect(error.kind).toBe("RULE_EVALUATION_ERROR");
    expect(error.code).toBe("MONEY_OVERFLOW");
  });

  it("conflicts when two confirmed rules state different amounts for one component", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule("r.fee1", feePayload("synthetic.p", "synthetic.official", { kind: "FIXED", amount: money(8500) })),
          rule("r.fee2", feePayload("synthetic.p", "synthetic.official", { kind: "FIXED", amount: money(9500) })),
        ],
        base,
      ),
    );
    expect(error.code).toBe("DECISION_CONFLICT");
  });

  it("merges duplicate identical fee statements", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule("r.fee1", feePayload("synthetic.p", "synthetic.official", { kind: "FIXED", amount: money(8500) })),
          rule("r.fee2", feePayload("synthetic.p", "synthetic.official", { kind: "FIXED", amount: money(8500) })),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations).toHaveLength(1);
    expect(decision.feeCalculations[0]?.provenance).toHaveLength(2);
  });

  it("keeps multiple components separate and never mixes currencies", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          caseTypeRule(),
          rule("r.p", procedurePayload("synthetic.p")),
          rule("r.fee1", feePayload("synthetic.p", "synthetic.a", { kind: "FIXED", amount: money(8500) })),
          rule("r.fee2", feePayload("synthetic.p", "synthetic.b", { kind: "FIXED", amount: money(500, "EUR") })),
        ],
        base,
      ),
    );
    expect(decision.feeCalculations).toHaveLength(2);
    expect(decision.costEstimate.confirmedOfficial).toEqual([
      { currency: "EUR", amountMinorUnits: 500 },
      { currency: "PYG", amountMinorUnits: 8500 },
    ]);
  });
});

describe("cost estimate", () => {
  it("refuses to overflow a currency total", () => {
    const fees: FeeCalculation[] = [
      {
        forProcedure: "rp1:a" as never,
        componentCode: id("c1"),
        feeType: "FIXED_AMOUNT",
        formula: { kind: "FIXED", amount: money(Number.MAX_SAFE_INTEGER) },
        calculatedAmount: money(Number.MAX_SAFE_INTEGER),
        unresolvedReason: null,
        support: "CONFIRMED",
        provenance: [],
      },
      {
        forProcedure: "rp1:a" as never,
        componentCode: id("c2"),
        feeType: "FIXED_AMOUNT",
        formula: { kind: "FIXED", amount: money(Number.MAX_SAFE_INTEGER) },
        calculatedAmount: money(Number.MAX_SAFE_INTEGER),
        unresolvedReason: null,
        support: "CONFIRMED",
        provenance: [],
      },
    ];
    expect(buildCostEstimate(fees).ok).toBe(false);
  });

  it("is empty for a case with no fees", () => {
    const estimate = buildCostEstimate([]);
    expect(estimate.ok && estimate.value).toEqual({
      confirmedOfficial: [],
      indexedOfficial: [],
      unknownOfficialFeeCount: 0,
      externalVariableCostCodes: [],
    });
  });
});

describe("document reuse", () => {
  const withDocument = () => [
    caseTypeRule(),
    rule("r.p", procedurePayload("synthetic.p")),
    rule("r.doc", documentPayload("synthetic.p", "synthetic.birth-certificate")),
  ];

  it("defaults to REUSE_UNKNOWN when no rule speaks", () => {
    const decision = expectOk(runEngine(userCaseFacts(), withDocument(), base));
    expect(decision.documentReuseAssessments).toHaveLength(1);
    expect(decision.documentReuseAssessments[0]?.resolution).toBe("REUSE_UNKNOWN");
    expect(decision.documentReuseAssessments[0]?.support).toBeNull();
  });

  it.each(["REUSABLE_CONFIRMED", "REUSE_NOT_ALLOWED", "REISSUE_REQUIRED"] as const)(
    "resolves %s from a rule",
    (resolution) => {
      const decision = expectOk(
        runEngine(
          userCaseFacts(),
          [...withDocument(), rule("r.reuse", reusePayload("synthetic.p", "synthetic.birth-certificate", resolution))],
          base,
        ),
      );
      expect(decision.documentReuseAssessments[0]?.resolution).toBe(resolution);
    },
  );

  it("asks for verification instead of guessing when the reuse rule is unresolved", () => {
    const decision = expectOk(
      runEngine(
        userCaseFacts(),
        [
          ...withDocument(),
          rule("r.reuse", reusePayload("synthetic.p", "synthetic.birth-certificate", "REUSABLE_CONFIRMED"), {
            verificationStatus: "OFFICIAL_VERIFICATION_REQUIRED",
            verification: { code: "DOCUMENT_REUSE_UNCONFIRMED", targetKind: "DOCUMENT" },
          }),
        ],
        base,
      ),
    );
    expect(decision.documentReuseAssessments[0]?.resolution).toBe("REUSE_UNKNOWN");
    expect(decision.verificationFlags.map((flag) => flag.code)).toContain("DOCUMENT_REUSE_UNCONFIRMED");
    expect(decision.verificationFlags[0]?.target.kind).toBe("DOCUMENT");
    expect(decision.caseClassification.status).toBe("NEEDS_OFFICIAL_VERIFICATION");
  });

  it("conflicts when two confirmed reuse rules disagree", () => {
    const error = expectErr(
      runEngine(
        userCaseFacts(),
        [
          ...withDocument(),
          rule("r.reuse1", reusePayload("synthetic.p", "synthetic.birth-certificate", "REUSABLE_CONFIRMED")),
          rule("r.reuse2", reusePayload("synthetic.p", "synthetic.birth-certificate", "REUSE_NOT_ALLOWED")),
        ],
        base,
      ),
    );
    expect(error.code).toBe("DECISION_CONFLICT");
  });
});
