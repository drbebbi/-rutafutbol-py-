import type {
  DocumentTypeId,
  ExternalCostCode,
  FeeComponentCode,
  FeeIndexId,
  FormalityCode,
  ProcedureId,
  VisaPurposeCode,
} from "../../domain/identifiers/identifiers";
import type { CountryCode } from "../../domain/primitives/country";
import type { Money } from "../../domain/primitives/money";
import type { CaseType } from "../../domain/case/classification";
import type { ResidenceClassification } from "../../domain/residence/residence";
import type { DocumentReuseResolution } from "../../domain/documents/required-document";
import type { FeeType } from "../../domain/fees/fee";
import type {
  VerificationCode,
  WarningCode,
  WarningSeverity,
} from "../../domain/evaluation/issues";
import type { RuleId } from "../../domain/identifiers/identifiers";
import type { UnresolvedReason } from "../../domain/rules/verification";
import type { ProcedureParameterValue } from "../../domain/procedures/procedure";
import type { RuleConditionNode } from "./ast";
import type { RuleFactPath } from "./fact-paths";
import type { RuleScope } from "./scopes";

/**
 * A procedure parameter as authored in a rule. Either a literal, or a
 * projection of a fact that the rule's condition has already guarded.
 */
export type ProcedureParameterTemplate = Readonly<{
  name: string;
  value:
    | Readonly<{ kind: "LITERAL"; literal: ProcedureParameterValue }>
    | Readonly<{ kind: "FACT"; path: RuleFactPath }>;
}>;

export type CountryTemplate =
  | Readonly<{ kind: "LITERAL"; countryCode: CountryCode }>
  | Readonly<{ kind: "FACT"; path: RuleFactPath }>;

/**
 * How a downstream rule points at a procedure produced upstream.
 *
 * `parameters: null` means "the procedure with this id, whatever its
 * parameters" - which is exactly the case that can turn out AMBIGUOUS and is
 * then a rule configuration error, never a silent first-match.
 */
export type ProcedureTargetSelector = Readonly<{
  procedureId: ProcedureId;
  parameters: readonly ProcedureParameterTemplate[] | null;
  discriminator: string | null;
}>;

export type DocumentTargetSelector = Readonly<{
  forProcedure: ProcedureTargetSelector;
  documentTypeId: DocumentTypeId;
  issuingCountry: CountryTemplate | null;
  discriminator: string | null;
}>;

export type RequirementValue = "REQUIRED" | "NOT_REQUIRED";

/**
 * Procedure rules are not additive-only: a rule may state that a procedure is
 * NOT required, and that statement participates in conflict resolution on
 * equal footing with a REQUIRED statement.
 */
export type ProcedureRequirementConsequence = Readonly<{
  procedureId: ProcedureId;
  parameters: readonly ProcedureParameterTemplate[];
  discriminator: string | null;
  requirement: RequirementValue;
}>;

export type FeeFormulaTemplate =
  | Readonly<{ kind: "FIXED"; amount: Money }>
  | Readonly<{ kind: "INDEXED"; multiplier: number; feeIndexId: FeeIndexId }>
  | Readonly<{ kind: "EXTERNAL_VARIABLE"; costCode: ExternalCostCode }>;

/* -------------------------------------------------------------------------- */
/* Precedence                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Precedence between rules.
 *
 * Only two relations exist, both explicit and both authored. There is no
 * numeric priority, no automatic specificity, no automatic source recency -
 * every one of those would silently decide a legal conflict on a heuristic.
 */
export type PrecedenceRelation = "EXCEPTION_TO" | "OVERRIDES";

export const PRECEDENCE_RELATIONS: readonly PrecedenceRelation[] = ["EXCEPTION_TO", "OVERRIDES"];

export type PrecedenceEdge = Readonly<{
  relation: PrecedenceRelation;
  /** The rule this rule takes precedence over. */
  overRuleId: RuleId;
}>;

/* -------------------------------------------------------------------------- */
/* Verification targets                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What an unresolved rule asks a human to verify, as authored.
 *
 * A template, not a resolved target: it names the procedure, document, visa
 * purpose or fee component by the same selectors the consequence families use,
 * and the engine resolves it against the decision it actually produced. There
 * is no CASE fallback - a template that resolves to nothing, or to more than
 * one thing, is a defect in the knowledge base.
 */
export type VerificationTargetTemplate =
  | Readonly<{ kind: "CASE" }>
  | Readonly<{ kind: "PROCEDURE"; targetProcedure: ProcedureTargetSelector }>
  | Readonly<{ kind: "DOCUMENT"; targetDocument: DocumentTargetSelector }>
  | Readonly<{ kind: "VISA_PURPOSE"; purposeCode: VisaPurposeCode }>
  | Readonly<{
      kind: "FEE_COMPONENT";
      targetProcedure: ProcedureTargetSelector;
      componentCode: FeeComponentCode;
    }>;

export type UnresolvedRuleVerification = Readonly<{
  code: VerificationCode;
  target: VerificationTargetTemplate;
}>;

/* -------------------------------------------------------------------------- */
/* Rule resolution                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Whether a rule states a consequence at all.
 *
 * This is the single most important shape in the rule model. A rule whose
 * evidence is conflicting, unknown or awaiting official verification carries
 * *no consequence whatsoever* - not a provisional one, not a "best guess", not
 * a substituted neighbour. It carries a verification request and nothing else,
 * so there is no field an unresolved rule could leak a fabricated legal
 * statement through.
 */
export type RuleResolution<T> =
  | Readonly<{ state: "RESOLVED"; consequence: T }>
  | Readonly<{
      state: "UNRESOLVED";
      reason: UnresolvedReason;
      verification: UnresolvedRuleVerification;
    }>;

export const RULE_RESOLUTION_STATES: readonly ["RESOLVED", "UNRESOLVED"] = [
  "RESOLVED",
  "UNRESOLVED",
];

/* -------------------------------------------------------------------------- */
/* Rule payload families                                                       */
/* -------------------------------------------------------------------------- */

type PayloadBase = Readonly<{
  scope: RuleScope;
  condition: RuleConditionNode;
  precedence: readonly PrecedenceEdge[];
}>;

export type CaseTypeConsequence = Readonly<{ kind: "CASE_TYPE"; caseType: CaseType }>;

export type ResidenceClassificationConsequence = Readonly<{
  kind: "RESIDENCE_CLASSIFICATION";
  classification: ResidenceClassification;
}>;

export type ClassificationConsequence =
  | CaseTypeConsequence
  | ResidenceClassificationConsequence;

/**
 * `subject` is what the rule is about; the consequence is what it says.
 *
 * They are separate fields because an unresolved rule has no consequence at
 * all, and the engine still has to know which decision slot the rule's
 * verification request belongs to. Where a consequence exists, its `kind` must
 * equal `subject` - the validator enforces that.
 */
export type ClassificationRulePayload = PayloadBase &
  Readonly<{
    family: "CLASSIFICATION";
    subject: ClassificationConsequence["kind"];
    resolution: RuleResolution<ClassificationConsequence>;
  }>;

export type VisaConsequence = Readonly<{
  purposeCode: VisaPurposeCode;
  requirement: RequirementValue;
}>;

export type VisaRulePayload = PayloadBase &
  Readonly<{
    family: "VISA";
    resolution: RuleResolution<VisaConsequence>;
  }>;

export type ProcedureRulePayload = PayloadBase &
  Readonly<{
    family: "PROCEDURE";
    resolution: RuleResolution<ProcedureRequirementConsequence>;
  }>;

export type DocumentRequirementConsequence = Readonly<{
  forProcedure: ProcedureTargetSelector;
  documentTypeId: DocumentTypeId;
  issuingCountry: CountryTemplate | null;
  discriminator: string | null;
  requirement: RequirementValue;
}>;

export type DocumentRequirementPayload = PayloadBase &
  Readonly<{
    family: "DOCUMENT_REQUIREMENT";
    resolution: RuleResolution<DocumentRequirementConsequence>;
  }>;

export type DocumentFormalityConsequence = Readonly<{
  forDocument: DocumentTargetSelector;
  formalityCode: FormalityCode;
  requirement: RequirementValue;
}>;

export type DocumentFormalityPayload = PayloadBase &
  Readonly<{
    family: "DOCUMENT_FORMALITY";
    resolution: RuleResolution<DocumentFormalityConsequence>;
  }>;

export type DocumentReuseConsequence = Readonly<{
  forDocument: DocumentTargetSelector;
  /** REUSE_UNKNOWN is never authored: it is the absence of a rule. */
  resolution: Exclude<DocumentReuseResolution, "REUSE_UNKNOWN">;
}>;

export type DocumentReuseRulePayload = PayloadBase &
  Readonly<{
    family: "DOCUMENT_REUSE";
    resolution: RuleResolution<DocumentReuseConsequence>;
  }>;

export type DependencyConsequence = Readonly<{
  dependent: ProcedureTargetSelector;
  dependsOn: ProcedureTargetSelector;
  relation: "REQUIRED_BEFORE" | "NOT_REQUIRED_BEFORE";
}>;

export type DependencyRulePayload = PayloadBase &
  Readonly<{
    family: "DEPENDENCY";
    resolution: RuleResolution<DependencyConsequence>;
  }>;

export type FeeConsequence = Readonly<{
  forProcedure: ProcedureTargetSelector;
  componentCode: FeeComponentCode;
  feeType: FeeType;
  formula: FeeFormulaTemplate;
}>;

export type FeeRulePayload = PayloadBase &
  Readonly<{
    family: "FEE";
    resolution: RuleResolution<FeeConsequence>;
  }>;

export type WarningConsequence = Readonly<{
  code: WarningCode;
  severity: WarningSeverity;
  qualifier: string | null;
}>;

export type WarningRulePayload = PayloadBase &
  Readonly<{
    family: "WARNING";
    resolution: RuleResolution<WarningConsequence>;
  }>;

export type SpecialCaseCode =
  | "PARAGUAYAN_CITIZENSHIP"
  | "MINOR"
  | "PARAGUAYAN_PARENT"
  | "PARAGUAYAN_SPOUSE"
  | "REPATRIADO_FAMILY"
  | "DIPLOMATIC"
  | "PROTECTION"
  | "INVESTOR";

export const SPECIAL_CASE_CODES: readonly SpecialCaseCode[] = [
  "PARAGUAYAN_CITIZENSHIP",
  "MINOR",
  "PARAGUAYAN_PARENT",
  "PARAGUAYAN_SPOUSE",
  "REPATRIADO_FAMILY",
  "DIPLOMATIC",
  "PROTECTION",
  "INVESTOR",
];

export type SpecialCaseConsequence = Readonly<{ specialCaseCode: SpecialCaseCode }>;

/**
 * Special-case rules exist so a case that would otherwise fall out of product
 * scope is recognised as a known special case first.
 */
export type SpecialCaseRulePayload = PayloadBase &
  Readonly<{
    family: "SPECIAL_CASE";
    resolution: RuleResolution<SpecialCaseConsequence>;
  }>;

export type TimelineConsequence = WarningConsequence;

export type TimelineRulePayload = PayloadBase &
  Readonly<{
    family: "TIMELINE";
    resolution: RuleResolution<TimelineConsequence>;
  }>;

export type RulePayload =
  | ClassificationRulePayload
  | VisaRulePayload
  | ProcedureRulePayload
  | DocumentRequirementPayload
  | DocumentFormalityPayload
  | DocumentReuseRulePayload
  | DependencyRulePayload
  | FeeRulePayload
  | WarningRulePayload
  | SpecialCaseRulePayload
  | TimelineRulePayload;

export type RuleFamily = RulePayload["family"];

export const RULE_FAMILIES: readonly RuleFamily[] = [
  "CLASSIFICATION",
  "VISA",
  "PROCEDURE",
  "DOCUMENT_REQUIREMENT",
  "DOCUMENT_FORMALITY",
  "DOCUMENT_REUSE",
  "DEPENDENCY",
  "FEE",
  "WARNING",
  "SPECIAL_CASE",
  "TIMELINE",
];

/* -------------------------------------------------------------------------- */
/* Decision slots                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Decision slot families. Two candidate consequences only ever meet inside the
 * same slot, and precedence may only be declared between rules whose families
 * are compatible - a fee rule can never override a visa rule.
 */
export type DecisionSlotFamily =
  | "CASE_TYPE"
  | "RESIDENCE_CLASSIFICATION"
  | "VISA"
  | "PROCEDURE_REQUIREMENT"
  | "DOCUMENT_REQUIREMENT"
  | "FORMALITY"
  | "DEPENDENCY"
  | "DOCUMENT_REUSE"
  | "FEE"
  | "WARNING";

export const DECISION_SLOT_FAMILIES: readonly DecisionSlotFamily[] = [
  "CASE_TYPE",
  "RESIDENCE_CLASSIFICATION",
  "VISA",
  "PROCEDURE_REQUIREMENT",
  "DOCUMENT_REQUIREMENT",
  "FORMALITY",
  "DEPENDENCY",
  "DOCUMENT_REUSE",
  "FEE",
  "WARNING",
];

export function decisionSlotFamilyForPayload(payload: RulePayload): DecisionSlotFamily {
  switch (payload.family) {
    case "CLASSIFICATION":
      // `subject`, not the consequence: an unresolved classification rule has
      // no consequence and still belongs to a definite decision slot.
      return payload.subject === "CASE_TYPE" ? "CASE_TYPE" : "RESIDENCE_CLASSIFICATION";
    case "SPECIAL_CASE":
      return "CASE_TYPE";
    case "VISA":
      return "VISA";
    case "PROCEDURE":
      return "PROCEDURE_REQUIREMENT";
    case "DOCUMENT_REQUIREMENT":
      return "DOCUMENT_REQUIREMENT";
    case "DOCUMENT_FORMALITY":
      return "FORMALITY";
    case "DOCUMENT_REUSE":
      return "DOCUMENT_REUSE";
    case "DEPENDENCY":
      return "DEPENDENCY";
    case "FEE":
      return "FEE";
    case "WARNING":
    case "TIMELINE":
      return "WARNING";
  }
}

/**
 * Which fact access domains a family may read.
 *
 * Legal requirement families see only the applicant's legal situation.
 * Document reuse additionally sees what the applicant holds, because reuse is
 * a question *about* a held document. Warnings may also see entry readiness.
 */
export function allowedAccessDomainsForFamily(
  family: RuleFamily,
): readonly ("CASE_LEGAL" | "DOCUMENT_STATE" | "ENTRY_READINESS")[] {
  switch (family) {
    case "DOCUMENT_REUSE":
      return ["CASE_LEGAL", "DOCUMENT_STATE"];
    case "DOCUMENT_FORMALITY":
      /*
       * Formality rules may read what the applicant holds.
       *
       * Whether an apostille is needed on a document the applicant already
       * owns is a question about that document, so the rule has to be able to
       * see it. What readiness must never do is remove the underlying legal
       * requirement: holding a document is not the same as the law not asking
       * for it, and the requirement itself is decided by DOCUMENT_REQUIREMENT
       * rules, which stay confined to CASE_LEGAL.
       */
      return ["CASE_LEGAL", "DOCUMENT_STATE"];
    case "WARNING":
    case "TIMELINE":
      return ["CASE_LEGAL", "DOCUMENT_STATE", "ENTRY_READINESS"];
    case "CLASSIFICATION":
    case "SPECIAL_CASE":
    case "VISA":
    case "PROCEDURE":
    case "DOCUMENT_REQUIREMENT":
    case "DEPENDENCY":
    case "FEE":
      return ["CASE_LEGAL"];
  }
}

/* -------------------------------------------------------------------------- */
/* Resolution access helpers                                                   */
/* -------------------------------------------------------------------------- */

/** The verification an unresolved payload requests, or null if it is resolved. */
export function payloadVerification(payload: RulePayload): UnresolvedRuleVerification | null {
  return payload.resolution.state === "UNRESOLVED" ? payload.resolution.verification : null;
}
