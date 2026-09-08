import { ok, type Result } from "../../shared/result/result";
import type { ProvenanceRef } from "../../domain/evaluation/provenance";
import type { VisaPurposeCode } from "../../domain/identifiers/identifiers";
import type { CaseType } from "../../domain/case/classification";
import type {
  ResidenceClassification,
  ResidenceClassificationResult,
} from "../../domain/residence/residence";
import type { SupportLevel } from "../../domain/rules/verification";
import type { VerificationFlag } from "../../domain/evaluation/issues";
import type { RuleFactPath } from "../../rules/definitions/fact-paths";
import type {
  ClassificationRulePayload,
  RequirementValue,
  VisaRulePayload,
} from "../../rules/definitions/payloads";
import { compareStrings, consequenceKeyOf } from "../canonicalization/ordering";
import type { EngineError } from "../errors/engine-error";
import { resolveSlots, type SlotCandidate } from "../precedence/resolve-slot";
import { toVerificationFlag } from "../verification/flags";
import { dominatedRuleIds, instancesOf, type StageContext } from "../evaluate/stage-context";

type CaseTypeConsequence = Readonly<{ caseType: CaseType }>;
type ResidenceConsequence = Readonly<{ classification: ResidenceClassification }>;
type VisaConsequence = Readonly<{ requirement: RequirementValue }>;

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
  verifications: readonly VerificationFlag[];
  decisionRelevantFactPaths: readonly RuleFactPath[];
}>;

function baseCandidate<T>(
  instance: ReturnType<typeof instancesOf>[number],
  slotKey: string,
  slotFamily: SlotCandidate<T>["slotFamily"],
  consequence: T,
): SlotCandidate<T> & { provenance: ProvenanceRef } {
  return {
    slotKey,
    slotFamily,
    ruleId: instance.revision.ruleId,
    truth: instance.truth,
    resolution: instance.resolution,
    support: instance.support,
    unresolvedReason: instance.unresolvedReason,
    verification: instance.revision.verification,
    consequence: instance.resolution === "RESOLVED_CONSEQUENCE" ? consequence : null,
    consequenceKey:
      instance.resolution === "RESOLVED_CONSEQUENCE" ? consequenceKeyOf(consequence) : null,
    indeterminateFactPaths: instance.indeterminateFactPaths,
    unguardedNotApplicablePaths: instance.unguardedNotApplicablePaths,
    dominates: dominatedRuleIds(instance.revision),
    provenance: instance.provenance,
  };
}

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
  const caseTypeCandidates: (SlotCandidate<CaseTypeConsequence> & { provenance: ProvenanceRef })[] = [];
  const residenceCandidates: (SlotCandidate<ResidenceConsequence> & { provenance: ProvenanceRef })[] = [];
  const visaCandidates: (SlotCandidate<VisaConsequence> & { provenance: ProvenanceRef })[] = [];
  const visaPurposeBySlot = new Map<string, VisaPurposeCode>();

  for (const instance of instancesOf(stage, "CLASSIFICATION")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Grouped by family above; the cast records the invariant.
    const payload = instance.revision.payload as ClassificationRulePayload;
    if (payload.consequence.kind === "CASE_TYPE") {
      caseTypeCandidates.push(
        baseCandidate<CaseTypeConsequence>(instance, "CASE_TYPE", "CASE_TYPE", {
          caseType: payload.consequence.caseType,
        }),
      );
    } else {
      residenceCandidates.push(
        baseCandidate<ResidenceConsequence>(
          instance,
          "RESIDENCE_CLASSIFICATION",
          "RESIDENCE_CLASSIFICATION",
          { classification: payload.consequence.classification },
        ),
      );
    }
  }

  for (const instance of instancesOf(stage, "SPECIAL_CASE")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    // Every special-case rule says the same thing about the case type, so they
    // merge rather than conflict; the specific signal lives in the modifiers.
    caseTypeCandidates.push(
      baseCandidate<CaseTypeConsequence>(instance, "CASE_TYPE", "CASE_TYPE", {
        caseType: "SPECIAL_CASE",
      }),
    );
  }

  for (const instance of instancesOf(stage, "VISA")) {
    if (instance.truth === "FALSE") {
      continue;
    }
    const payload = instance.revision.payload as VisaRulePayload;
    const slotKey = `VISA:${payload.consequence.purposeCode as string}`;
    visaPurposeBySlot.set(slotKey, payload.consequence.purposeCode);
    visaCandidates.push(
      baseCandidate<VisaConsequence>(instance, slotKey, "VISA", {
        requirement: payload.consequence.requirement,
      }),
    );
  }

  const verifications: VerificationFlag[] = [];
  const relevantPaths = new Set<RuleFactPath>();

  const caseTypeResolved = resolveSlots(caseTypeCandidates);
  if (!caseTypeResolved.ok) {
    return caseTypeResolved;
  }
  let ruleCaseType: CaseType | null = null;
  let caseTypeSupport: SupportLevel | null = null;
  let caseTypeProvenance: readonly ProvenanceRef[] = [];
  for (const resolution of caseTypeResolved.value) {
    for (const verification of resolution.verifications) {
      verifications.push(toVerificationFlag(verification, {}));
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
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
  for (const resolution of residenceResolved.value) {
    for (const verification of resolution.verifications) {
      verifications.push(toVerificationFlag(verification, {}));
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    if (resolution.decided !== null) {
      residence = { state: "CLASSIFIED", classification: resolution.decided.consequence.classification };
      residenceProvenance = resolution.decided.provenance;
    } else if (resolution.verifications.length > 0) {
      residence = { state: "STATUS_REVIEW_REQUIRED", classification: null };
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
    for (const verification of resolution.verifications) {
      verifications.push(
        toVerificationFlag(
          verification,
          purposeCode === undefined ? {} : { purposeCode },
        ),
      );
    }
    for (const path of resolution.decisionRelevantFactPaths) {
      relevantPaths.add(path);
    }
    if (resolution.decided !== null && purposeCode !== undefined) {
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
    verifications,
    decisionRelevantFactPaths: [...relevantPaths].sort(),
  });
}
