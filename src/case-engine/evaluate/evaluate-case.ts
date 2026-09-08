import { err, ok, type Result } from "../../shared/result/result";
import type { UserCaseFacts } from "../../domain/case/user-case-facts";
import type { CaseClassificationReasonCode, CaseType } from "../../domain/case/classification";
import type { EvaluationExecutionContext } from "../../domain/evaluation/context";
import type { EngineDescriptor } from "../../domain/evaluation/engine-descriptor";
import type { CaseEvaluationDecision } from "../../domain/evaluation/decision";
import type { BlockingIssue, CaseModifier, VerificationFlag, Warning } from "../../domain/evaluation/issues";
import type { AppliedProductPolicyEffect } from "../../domain/product/product";
import type { SupportLevel } from "../../domain/rules/verification";
import type { RuleFamily } from "../../rules/definitions/payloads";
import type { EngineReadyBundleContent } from "../../rules/bundle/engine-ready-bundle";
import { engineInvariantViolation, type EngineError } from "../errors/engine-error";
import { projectRuleFactView } from "../classify/fact-view";
import { knownSpecialCaseGuard } from "../classify/special-case-guard";
import { runProductCoveragePrecheck } from "../classify/product-coverage";
import { runProductPolicyGate } from "../classify/product-policy-gate";
import { runClassificationStage } from "../classify/classification-stage";
import { canonicalModifiers, deriveStructuralModifiers, visaModifiers } from "../modifiers/structural-modifiers";
import { runProcedureStage } from "../procedures/procedure-stage";
import { runDocumentStage } from "../documents/document-stage";
import { runReuseStage } from "../documents/reuse-stage";
import { runDependencyStage } from "../graph/dependency-stage";
import { runFeeStage } from "../fees/fee-stage";
import { buildCostEstimate } from "../fees/cost-estimate";
import { runWarningStage } from "../warnings/warning-stage";
import { buildBlockingIssues, type BlockingFactPath } from "../verification/blocking-issues";
import { canonicalVerificationFlags } from "../verification/flags";
import {
  collectPendingVerifications,
  resolveUnresolvedRules,
} from "../verification/unresolved-rules";
import { evaluateRuleInstances, type RuleInstance } from "./rule-instances";
import type { StageContext } from "./stage-context";
import { assessCompletion, finalStatus } from "./completion";
import { selectPathway } from "./pathway";

/**
 * The pure evaluation entry point.
 *
 * No database, no HTTP, no clock, no environment, no auth session, no logging,
 * no persistence, no random identifiers. Given the same facts, execution
 * context, bundle and engine descriptor, this function always returns the same
 * decision - which is what makes a stored evaluation reproducible and
 * auditable years later.
 */
export function evaluateCase(
  facts: UserCaseFacts,
  context: EvaluationExecutionContext,
  bundle: EngineReadyBundleContent,
  engine: EngineDescriptor,
): Result<CaseEvaluationDecision, EngineError> {
  if ((bundle.effectiveLocalDate as string) !== (context.effectiveLocalDate as string)) {
    return err(
      engineInvariantViolation(
        "BUNDLE_EFFECTIVE_DATE_MISMATCH",
        `bundle was assembled for ${bundle.effectiveLocalDate} but the context asks for ${context.effectiveLocalDate}`,
      ),
    );
  }

  const view = projectRuleFactView(facts, context);

  const instancesByFamily = new Map<RuleFamily, RuleInstance[]>();
  for (const revision of bundle.ruleRevisions) {
    const instances = evaluateRuleInstances(revision, view, context);
    if (!instances.ok) {
      return instances;
    }
    const list = instancesByFamily.get(revision.payload.family) ?? [];
    list.push(...instances.value);
    instancesByFamily.set(revision.payload.family, list);
  }

  const stage: StageContext = { view, context, bundle, engine, instancesByFamily };

  /*
   * Rules travel on two tracks that never merge.
   *
   * Rules that state a consequence go through the decision slots below. Rules
   * that state no consequence - conflicting, unknown or awaiting official
   * verification - are collected here and resolved at the very end, once the
   * procedures, documents and fees their requests point at exist. Nothing on
   * the second track can ever contribute a legal statement.
   */
  const pendingVerifications = collectPendingVerifications(instancesByFamily);
  const suppressedRuleIds = new Set<string>();

  const blockingPaths: BlockingFactPath[] = [];
  const verificationFlags: VerificationFlag[] = [];

  /* -- stage 1: product coverage precheck --------------------------------- */
  const guard = knownSpecialCaseGuard(facts);
  const coverage = runProductCoveragePrecheck(facts, bundle, guard);
  for (const path of coverage.blockingFactPaths) {
    blockingPaths.push({ path, slotFamily: "PRODUCT_COVERAGE" });
  }

  /* -- legal classification ---------------------------------------------- */
  const classification = runClassificationStage(stage);
  if (!classification.ok) {
    return classification;
  }
  for (const ruleId of classification.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of classification.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "CASE_TYPE" });
  }

  /* -- procedures --------------------------------------------------------- */
  const procedures = runProcedureStage(stage);
  if (!procedures.ok) {
    return procedures;
  }
  for (const ruleId of procedures.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of procedures.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "PROCEDURE_REQUIREMENT" });
  }

  /* -- documents and formalities ------------------------------------------ */
  const documents = runDocumentStage(stage, procedures.value.index);
  if (!documents.ok) {
    return documents;
  }
  for (const ruleId of documents.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of documents.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "DOCUMENT_REQUIREMENT" });
  }

  /* -- dependencies ------------------------------------------------------- */
  const dependencies = runDependencyStage(
    stage,
    procedures.value.index,
    procedures.value.requiredProcedures,
  );
  if (!dependencies.ok) {
    return dependencies;
  }
  for (const ruleId of dependencies.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of dependencies.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "DEPENDENCY" });
  }

  /* -- document reuse ------------------------------------------------------ */
  const reuse = runReuseStage(
    stage,
    procedures.value.index,
    documents.value.documentIndex,
    documents.value.requiredDocuments,
  );
  if (!reuse.ok) {
    return reuse;
  }
  for (const ruleId of reuse.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of reuse.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "DOCUMENT_REUSE" });
  }

  /* -- fees ---------------------------------------------------------------- */
  const fees = runFeeStage(stage, procedures.value.index);
  if (!fees.ok) {
    return fees;
  }
  for (const ruleId of fees.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of fees.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "FEE" });
  }
  for (const fee of fees.value.feeCalculations) {
    if (fee.unresolvedReason === null || fee.unresolvedReason === "EXTERNAL_OR_VARIABLE") {
      continue;
    }
    verificationFlags.push({
      code: "FEE_AMOUNT_UNCONFIRMED",
      target: {
        kind: "FEE_COMPONENT",
        procedureKey: fee.forProcedure,
        componentCode: fee.componentCode,
      },
      reason: "UNKNOWN",
      provenance: fee.provenance,
    });
  }

  /* -- warnings and timelines ---------------------------------------------- */
  const warningStage = runWarningStage(stage);
  if (!warningStage.ok) {
    return warningStage;
  }
  for (const ruleId of warningStage.value.suppressedRuleIds) {
    suppressedRuleIds.add(ruleId);
  }
  for (const path of warningStage.value.decisionRelevantFactPaths) {
    blockingPaths.push({ path, slotFamily: "WARNING" });
  }

  /* -- unresolved rules: verification requests and their blockers ---------- */
  const feeComponentKeys = new Set(
    fees.value.feeCalculations.map(
      (fee) => `${fee.forProcedure as string}|${fee.componentCode as string}`,
    ),
  );
  const unresolved = resolveUnresolvedRules(pendingVerifications, suppressedRuleIds, {
    view,
    procedureIndex: procedures.value.index,
    documentIndex: documents.value.documentIndex,
    feeComponentKeys,
    engine,
  });
  if (!unresolved.ok) {
    return unresolved;
  }
  verificationFlags.push(...unresolved.value.flags);
  blockingPaths.push(...unresolved.value.blockingPaths);

  /*
   * Residence classification with an open verification request.
   *
   * The rules that could have classified the residence stated a question
   * instead of an answer, so the status is under review - not unresolved for
   * want of an answer from the user, and certainly not classified.
   */
  const residenceResult = unresolved.value.familiesWithFlags.has("RESIDENCE_CLASSIFICATION")
    && classification.value.residence.state !== "CLASSIFIED"
      ? ({ state: "STATUS_REVIEW_REQUIRED", classification: null } as const)
      : classification.value.residence;

  /* -- case type resolution (stage 2 result) ------------------------------- */
  const structuralCaseType = resolveStructuralCaseType(facts, coverage.decision.state, guard.state);
  const caseType: CaseType | null = structuralCaseType ?? classification.value.ruleCaseType;

  /* -- stage 3: product policy gate ---------------------------------------- */
  const policy = runProductPolicyGate(
    {
      desiredProcedure: facts.classification.desiredProcedure,
      coverageCountry: coverage.view.coverageCountry,
      coverageState: coverage.decision.state,
      caseType,
    },
    coverage.decision,
    bundle,
  );
  if (!policy.ok) {
    return policy;
  }

  const warnings: Warning[] = [...warningStage.value.warnings];
  const productEffects: readonly AppliedProductPolicyEffect[] = policy.value.effects;
  let policyDeclaredUnsupported = false;
  for (const applied of productEffects) {
    switch (applied.effect.kind) {
      case "UNSUPPORTED":
        policyDeclaredUnsupported = true;
        break;
      case "VERIFICATION_REQUIRED":
        verificationFlags.push({
          code: applied.effect.code,
          target: { kind: "CASE" },
          reason: "UNKNOWN",
          provenance: [],
        });
        break;
      case "BLOCKING":
        blockingPaths.push({
          issueCode: applied.effect.code,
          slotFamily: "PRODUCT_POLICY",
        });
        break;
      case "WARNING":
        warnings.push({
          code: "PRODUCT_SCOPE_PARTIAL",
          severity: "INFO",
          qualifier: applied.effect.code,
          provenance: [],
        });
        break;
    }
  }

  const blockingIssues = buildBlockingIssues(blockingPaths);
  if (!blockingIssues.ok) {
    return blockingIssues;
  }

  const unsupported =
    policyDeclaredUnsupported ||
    coverage.decision.state === "NOT_SUPPORTED" ||
    caseType === "COUNTRY_NOT_SUPPORTED" ||
    caseType === "NOT_FIRST_CEDULA";

  let flags = canonicalVerificationFlags(verificationFlags);
  const issues: readonly BlockingIssue[] = blockingIssues.value;

  /*
   * A case with nothing open but no classification is not "complete": the
   * engine simply could not classify it. Saying so as an official verification
   * requirement is honest; inventing a case type would not be.
   */
  if (!unsupported && caseType === null && issues.length === 0 && flags.length === 0) {
    flags = canonicalVerificationFlags([
      ...flags,
      {
        code: "CASE_CLASSIFICATION_UNCONFIRMED",
        target: { kind: "CASE" },
        reason: "UNKNOWN",
        provenance: [],
      },
    ]);
  }

  const assessment = assessCompletion(unsupported, issues, flags);

  let applicablePathway = null as CaseEvaluationDecision["applicablePathway"];
  if (assessment === "OTHERWISE_COMPLETE") {
    if (caseType === null) {
      return err(
        engineInvariantViolation(
          "CASE_TYPE_INVARIANT_VIOLATED",
          "an otherwise-complete case must have a case type",
        ),
      );
    }
    const pathway = selectPathway(
      bundle,
      caseType,
      procedures.value.requiredProcedures,
      dependencies.value.dependencies,
    );
    if (!pathway.ok) {
      return pathway;
    }
    applicablePathway = pathway.value;
  }

  const supports: (SupportLevel | null)[] = [
    classification.value.caseTypeSupport,
    ...procedures.value.requiredProcedures.map((procedure) => procedure.support),
    ...documents.value.requiredDocuments.map((document) => document.support),
    ...documents.value.requiredDocuments.flatMap((document) =>
      document.formalities.map((formality) => formality.support),
    ),
    ...dependencies.value.dependencies.map((dependency) => dependency.support),
    ...fees.value.feeCalculations.map((fee) => fee.support),
  ];
  const restsOnStrongEvidenceOnly = supports.some((support) => support === "STRONG_EVIDENCE");
  if (restsOnStrongEvidenceOnly && assessment === "OTHERWISE_COMPLETE") {
    warnings.push({ code: "STRONG_EVIDENCE_ONLY", severity: "CAUTION", qualifier: null, provenance: [] });
  }

  const status = finalStatus(assessment, warnings.length > 0, restsOnStrongEvidenceOnly);

  if (
    (status === "COMPLETE" || status === "COMPLETE_WITH_WARNINGS" || status === "UNSUPPORTED") &&
    caseType === null
  ) {
    return err(
      engineInvariantViolation(
        "CASE_TYPE_INVARIANT_VIOLATED",
        `status ${status} requires a case type`,
      ),
    );
  }

  const modifiers: readonly CaseModifier[] = canonicalModifiers([
    ...deriveStructuralModifiers(facts, guard),
    ...visaModifiers(classification.value.visaDecisions),
  ]);

  const costEstimate = buildCostEstimate(fees.value.feeCalculations);
  if (!costEstimate.ok) {
    return costEstimate;
  }

  const reasonCodes = classificationReasonCodes({
    caseType,
    structuralCaseType,
    ruleCaseType: classification.value.ruleCaseType,
    coverageState: coverage.decision.state,
    policyDeclaredUnsupported,
    hasBlockingIssues: issues.length > 0,
    hasVerificationFlags: flags.length > 0,
  });

  return ok({
    residenceClassification: residenceResult,
    productAssessment: { coverage: coverage.decision, effects: productEffects },
    caseClassification: {
      caseType,
      status,
      reasonCodes,
      provenance: {
        rules: classification.value.caseTypeProvenance,
        productPolicies: productEffects.map((applied) => applied.provenance),
        productCoverages: coverage.decision.provenance,
      },
    },
    applicablePathway,
    modifiers,
    blockingIssues: issues,
    verificationFlags: flags,
    requiredProcedures: procedures.value.requiredProcedures,
    procedureDependencies: dependencies.value.dependencies,
    requiredDocuments: documents.value.requiredDocuments,
    documentReuseAssessments: reuse.value.assessments,
    warnings: [...warnings].sort((a, b) =>
      `${a.code}|${a.qualifier ?? "-"}` < `${b.code}|${b.qualifier ?? "-"}` ? -1 : 1,
    ),
    feeCalculations: fees.value.feeCalculations,
    costEstimate: costEstimate.value,
  });
}

/**
 * Case types decided by product scope rather than by legal rules.
 *
 * These are statements about what this product will serve, not about the law.
 * They take precedence over a rule-derived case type because a terminal
 * routing decision has to be coherent: a case the product refuses to serve
 * must not be presented as a standard case. The legal statements the rules
 * produced are untouched - only the routing label changes.
 *
 * The order matters. "Not a first cedula" is checked before country scope so
 * that a returning applicant is told the real reason, and the special-case
 * bypass is checked last so it can never mask one of the two above.
 */
function resolveStructuralCaseType(
  facts: UserCaseFacts,
  coverageState: string,
  guardState: string,
): CaseType | null {
  const previous = facts.classification.holdsPreviousParaguayanCedula;
  if (previous.state === "KNOWN" && previous.value) {
    return "NOT_FIRST_CEDULA";
  }
  if (facts.classification.desiredProcedure !== "FIRST_CEDULA") {
    return "NOT_FIRST_CEDULA";
  }
  if (coverageState === "NOT_SUPPORTED" && guardState === "NONE") {
    return "COUNTRY_NOT_SUPPORTED";
  }
  if (coverageState === "BYPASSED_SPECIAL_CASE" && guardState === "CONFIRMED") {
    return "SPECIAL_CASE";
  }
  return null;
}

/**
 * Why the case ended up with this type and status.
 *
 * Structural reasons first, because they are the ones a user is most likely to
 * be surprised by - "we do not serve your country" is a very different message
 * from "we could not classify your case" - and then the two open-work reasons,
 * which say what would have to happen for the answer to change.
 */
function classificationReasonCodes(
  input: Readonly<{
    caseType: CaseType | null;
    structuralCaseType: CaseType | null;
    ruleCaseType: CaseType | null;
    coverageState: string;
    policyDeclaredUnsupported: boolean;
    hasBlockingIssues: boolean;
    hasVerificationFlags: boolean;
  }>,
): readonly CaseClassificationReasonCode[] {
  const codes = new Set<CaseClassificationReasonCode>();

  if (input.structuralCaseType === "NOT_FIRST_CEDULA") {
    codes.add(
      input.caseType === "NOT_FIRST_CEDULA" && input.coverageState !== "NOT_SUPPORTED"
        ? "PREVIOUS_CEDULA_DECLARED"
        : "PROCEDURE_OUT_OF_PRODUCT_SCOPE",
    );
  }
  if (input.structuralCaseType === "COUNTRY_NOT_SUPPORTED") {
    codes.add("COUNTRY_OUT_OF_PRODUCT_SCOPE");
  }
  if (input.structuralCaseType === "SPECIAL_CASE") {
    codes.add("SPECIAL_CASE_BYPASS");
  }
  if (input.policyDeclaredUnsupported) {
    codes.add("PRODUCT_POLICY_DECLINED");
  }
  if (input.structuralCaseType === null) {
    codes.add(input.ruleCaseType === null ? "NO_RULE_CLASSIFIED_THE_CASE" : "CLASSIFIED_BY_RULE");
  }
  if (input.hasBlockingIssues) {
    codes.add("USER_INFORMATION_MISSING");
  }
  if (input.hasVerificationFlags) {
    codes.add("OFFICIAL_VERIFICATION_OPEN");
  }
  return [...codes].sort();
}
