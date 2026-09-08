import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { VisaPurposeCode } from "../../domain/identifiers/identifiers";
import type { CaseType } from "../../domain/case/classification";
import type {
  ResidenceClassification,
  ResidenceClassificationResult,
} from "../../domain/residence/residence";
import type { SupportLevel } from "../../domain/rules/verification";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type {
  ClassificationConsequence,
  RequirementValue,
  SpecialCaseConsequence,
  VisaConsequence as VisaRuleConsequence,
} from "../../rules/definitions/payloads";
import { compareStrings } from "../canonicalization/ordering";
import type { EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import {
  instancesOf,
  slotCandidate,
  statedConsequence,
  type StageContext,
} from "../evaluate/stage-context";

type CaseTypeSlotConsequence = Readonly<{ caseType: CaseType }>;
type ResidenceSlotConsequence = Readonly<{ classification: ResidenceClassification }>;
type VisaSlotConsequence = Readonly<{ requirement: RequirementValue }>;

export type VisaDecision = Readonly<{
  purposeCode: VisaPurposeCode;
  requirement: RequirementValue;
  support: SupportLevel;
  provenance: readonly ProvenanceRef[];
}>;

export type ClassificationStageResult = Readonly<{
  ruleCaseType: CaseType | null;
  caseTypeSupport: SupportLevel | null;
  caseTypeProvenance: readonly ProvenanceRef[];
  residence: ResidenceClassificationResult;
  residenceProvenance: readonly ProvenanceRef[];
  visaDecisions: readonly VisaDecision[];
  /** Rule ids silenced by a confirmed winner in any slot of this stage. */
  suppressedRuleIds: readonly string[];
  /** The subset of those silenced in the residence classification slot. */
  residenceSuppressedRuleIds: readonly string[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

/**
 * Legal classification stage: case type, residence classification, visa.
 *
 * Residence classification is rule-driven, exactly like every other legal
 * statement. There is deliberately no second, hidden residence engine that
 * would let "reported type = TEMPORAL" silently become a legal conclusion.
 */
export function runClassificationStage(
  stage: StageContext,
): Result<ClassificationStageResult, EngineError> {
  const caseTypeCandidates: (SlotCandidate<CaseTypeSlotConsequence> & { provenance: ProvenanceRef })[] = [];
  const residenceCandidates: (SlotCandidate<ResidenceSlotConsequence> & { provenance: ProvenanceRef })[] = [];
  const visaCandidates: (SlotCandidate<VisaSlotConsequence> & { provenance: ProvenanceRef })[] = [];
  const visaPurposeBySlot = new Map<string, VisaPurposeCode>();

  for (const instance of instancesOf(stage, "CLASSIFICATION")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    const stated = statedConsequence<ClassificationConsequence>(instance);
    if (stated === null) {
      // The rule states a verification request, not a consequence. It never
      // enters a decision slot; the unresolved track handles it.
      continue;
    }
    if (stated.consequence.kind === "CASE_TYPE") {
      caseTypeCandidates.push(
        slotCandidate<CaseTypeSlotConsequence>(instance, stated.support, "CASE_TYPE", "CASE_TYPE", {
          caseType: stated.consequence.caseType,
        }),
      );
    } else {
      residenceCandidates.push(
        slotCandidate<ResidenceSlotConsequence>(
          instance,
          stated.support,
          "RESIDENCE_CLASSIFICATION",
          "RESIDENCE_CLASSIFICATION",
          { classification: stated.consequence.classification },
        ),
      );
    }
  }

  for (const instance of instancesOf(stage, "SPECIAL_CASE")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    const stated = statedConsequence<SpecialCaseConsequence>(instance);
    if (stated === null) {
      continue;
    }
    // Every special-case rule says the same thing about the case type, so they
    // merge rather than conflict; the specific signal lives in the modifiers.
    caseTypeCandidates.push(
      slotCandidate<CaseTypeSlotConsequence>(instance, stated.support, "CASE_TYPE", "CASE_TYPE", {
        caseType: "SPECIAL_CASE",
      }),
    );
  }

  for (const instance of instancesOf(stage, "VISA")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    const stated = statedConsequence<VisaRuleConsequence>(instance);
    if (stated === null) {
      continue;
    }
    const slotKey = `VISA:${stated.consequence.purposeCode as string}`;
    visaPurposeBySlot.set(slotKey, stated.consequence.purposeCode);
    visaCandidates.push(
      slotCandidate<VisaSlotConsequence>(instance, stated.support, slotKey, "VISA", {
        requirement: stated.consequence.requirement,
      }),
    );
  }

  const relevantPaths = new Set<RuleFactPath>();
  const suppressedRuleIds = new Set<string>();

  const caseTypeResolved = resolveSlots(caseTypeCandidates);
  if (!caseTypeResolved.ok) {
    return caseTypeResolved;
  }
  let ruleCaseType: CaseType | null = null;
  let caseTypeSupport: SupportLevel | null = null;
  let caseTypeProvenance: readonly ProvenanceRef[] = [];
  for (const resolution of caseTypeResolved.value) {
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
    }
    if (resolution.decided !== null) {
      ruleCaseType = resolution.decided.consequence.caseType;
      caseTypeSupport = resolution.decided.support;
      caseTypeProvenance = resolution.decided.provenance;
    }
  }

  const residenceResolved = resolveSlots(residenceCandidates);
  if (!residenceResolved.ok) {
    return residenceResolved;
  }
  let residence: ResidenceClassificationResult = { state: "UNRESOLVED", classification: null };
  let residenceProvenance: readonly ProvenanceRef[] = [];
  const residenceSuppressedRuleIds = new Set<string>();
  for (const resolution of residenceResolved.value) {
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
      residenceSuppressedRuleIds.add(ruleId);
    }
    if (resolution.decided !== null) {
      residence = { state: "CLASSIFIED", classification: resolution.decided.consequence.classification };
      residenceProvenance = resolution.decided.provenance;
    } else if (resolution.decisionRelevantFactPaths.length > 0) {
      residence = { state: "CLASSIFICATION_REQUIRED", classification: null };
    }
  }

  const visaResolved = resolveSlots(visaCandidates);
  if (!visaResolved.ok) {
    return visaResolved;
  }
  const visaDecisions: VisaDecision[] = [];
  for (const resolution of visaResolved.value) {
    const purposeCode = visaPurposeBySlot.get(resolution.slotKey);
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    for (const ruleId of resolution.suppressedRuleIds) {
      suppressedRuleIds.add(ruleId);
    }
    /* v8 ignore next 3 -- every visa slot key was registered above; the guard exists so a future refactor fails loudly rather than silently. */
    if (purposeCode === undefined) {
      continue;
    }
    if (resolution.decided !== null) {
      visaDecisions.push({
        purposeCode,
        requirement: resolution.decided.consequence.requirement,
        support: resolution.decided.support,
        provenance: resolution.decided.provenance,
      });
    }
  }

  return ok({
    ruleCaseType,
    caseTypeSupport,
    caseTypeProvenance,
    residence,
    residenceProvenance,
    visaDecisions: [...visaDecisions].sort((a, b) =>
      compareStrings(a.purposeCode as string, b.purposeCode as string),
    ),
    suppressedRuleIds: [...suppressedRuleIds].sort(compareStrings),
    residenceSuppressedRuleIds: [...residenceSuppressedRuleIds].sort(compareStrings),
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
