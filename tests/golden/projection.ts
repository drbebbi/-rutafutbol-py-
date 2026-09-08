import type { CaseEvaluationDecision } from "../../src/domain/evaluation/decision";

/**
 * Canonical test projection.
 *
 * This is a *test* serialization contract: not the public DTO, not a
 * persistence row. Keeping it separate means a change to either of those is
 * caught by the golden suite instead of silently rewriting the expectations.
 */
export type GoldenProjection = Readonly<{
  status: string;
  caseType: string | null;
  residence: string;
  pathway: string | null;
  modifiers: readonly string[];
  blockingIssues: readonly string[];
  verificationFlags: readonly string[];
  requiredProcedures: readonly string[];
  procedureDependencies: readonly string[];
  requiredDocuments: readonly string[];
  documentReuse: readonly string[];
  warnings: readonly string[];
  fees: readonly string[];
  costEstimate: Readonly<{
    confirmedOfficial: readonly string[];
    indexedOfficial: readonly string[];
    unknownOfficialFeeCount: number;
    externalVariableCostCodes: readonly string[];
  }>;
}>;

function targetRef(flag: CaseEvaluationDecision["verificationFlags"][number]): string {
  const target = flag.target;
  switch (target.kind) {
    case "CASE":
      return "CASE";
    case "PROCEDURE":
      return `PROCEDURE:${target.procedureKey as string}`;
    case "DOCUMENT":
      return `DOCUMENT:${target.documentKey as string}`;
    case "VISA_PURPOSE":
      return `VISA_PURPOSE:${target.purposeCode as string}`;
    case "FEE_COMPONENT":
      return `FEE_COMPONENT:${target.procedureKey as string}:${target.componentCode as string}`;
  }
}

export function projectDecision(decision: CaseEvaluationDecision): GoldenProjection {
  return {
    status: decision.caseClassification.status,
    caseType: decision.caseClassification.caseType,
    residence: `${decision.residenceClassification.state}:${decision.residenceClassification.classification ?? "-"}`,
    pathway: decision.applicablePathway === null ? null : (decision.applicablePathway as string),
    modifiers: decision.modifiers.map((entry) => `${entry.code}:${entry.qualifier ?? "-"}`),
    blockingIssues: decision.blockingIssues.map((entry) => `${entry.code}@${entry.blockedSlotFamily}`),
    verificationFlags: decision.verificationFlags.map(
      (entry) => `${entry.code}@${targetRef(entry)}:${entry.reason}`,
    ),
    requiredProcedures: decision.requiredProcedures.map(
      (entry) => `${entry.key as string}#${entry.support}`,
    ),
    procedureDependencies: decision.procedureDependencies.map(
      (entry) => `${entry.dependent as string}<-${entry.dependsOn as string}`,
    ),
    requiredDocuments: decision.requiredDocuments.map((entry) => {
      const formalities = entry.formalities.map((formality) => formality.formalityCode as string).join(",");
      return `${entry.key as string}#${entry.support}${formalities === "" ? "" : `[${formalities}]`}`;
    }),
    documentReuse: decision.documentReuseAssessments.map(
      (entry) => `${entry.documentKey as string}=${entry.resolution}`,
    ),
    warnings: decision.warnings.map((entry) => `${entry.code}:${entry.severity}:${entry.qualifier ?? "-"}`),
    fees: decision.feeCalculations.map((entry) => {
      const amount =
        entry.calculatedAmount === null
          ? `UNRESOLVED(${entry.unresolvedReason ?? "-"})`
          : `${entry.calculatedAmount.amountMinorUnits} ${entry.calculatedAmount.currency as string}`;
      return `${entry.forProcedure as string}:${entry.componentCode as string}=${amount}`;
    }),
    costEstimate: {
      confirmedOfficial: decision.costEstimate.confirmedOfficial.map(
        (entry) => `${entry.amountMinorUnits} ${entry.currency as string}`,
      ),
      indexedOfficial: decision.costEstimate.indexedOfficial.map(
        (entry) => `${entry.amountMinorUnits} ${entry.currency as string}`,
      ),
      unknownOfficialFeeCount: decision.costEstimate.unknownOfficialFeeCount,
      externalVariableCostCodes: decision.costEstimate.externalVariableCostCodes.map(
        (code) => code as string,
      ),
    },
  };
}
