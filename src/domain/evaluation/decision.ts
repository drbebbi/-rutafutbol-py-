import type { PathwayId } from "../identifiers/identifiers";
import type { CaseClassification } from "../case/classification";
import type { ResidenceClassificationResult } from "../residence/residence";
import type {
  RequiredProcedure,
  RequiredProcedureDependency,
} from "../procedures/procedure";
import type { DocumentReuseAssessment, RequiredDocument } from "../documents/required-document";
import type { CostEstimate, FeeCalculation } from "../fees/fee";
import type { ProductAssessment } from "../product/product";
import type { BlockingIssue, CaseModifier, VerificationFlag, Warning } from "./issues";

/**
 * The pure output of the engine.
 *
 * No persistence identifiers appear here: no row ids, no bundle id, no
 * evaluation id. Those belong to the record that *stores* a decision, not to
 * the decision itself, which must be a pure function of its inputs.
 */
export type CaseEvaluationDecision = Readonly<{
  residenceClassification: ResidenceClassificationResult;
  /**
   * What the product decided about serving this case, kept separate from the
   * legal statements so the two can never be confused for one another.
   */
  productAssessment: ProductAssessment;
  caseClassification: CaseClassification;
  applicablePathway: PathwayId | null;
  modifiers: readonly CaseModifier[];
  blockingIssues: readonly BlockingIssue[];
  verificationFlags: readonly VerificationFlag[];
  requiredProcedures: readonly RequiredProcedure[];
  procedureDependencies: readonly RequiredProcedureDependency[];
  requiredDocuments: readonly RequiredDocument[];
  documentReuseAssessments: readonly DocumentReuseAssessment[];
  warnings: readonly Warning[];
  feeCalculations: readonly FeeCalculation[];
  costEstimate: CostEstimate;
}>;
