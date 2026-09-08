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
import type { WarningCode, WarningSeverity } from "../../domain/evaluation/issues";
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
/* Rule payload families                                                       */
/* -------------------------------------------------------------------------- */

type PayloadBase = Readonly<{
  scope: RuleScope;
  condition: RuleConditionNode;
}>;

export type ClassificationRulePayload = PayloadBase &
  Readonly<{
    family: "CLASSIFICATION";
    consequence:
      | Readonly<{ kind: "CASE_TYPE"; caseType: CaseType }>
      | Readonly<{ kind: "RESIDENCE_CLASSIFICATION"; classification: ResidenceClassification }>;
  }>;

export type VisaRulePayload = PayloadBase &
  Readonly<{
    family: "VISA";
    consequence: Readonly<{ purposeCode: VisaPurposeCode; requirement: RequirementValue }>;
  }>;

export type ProcedureRulePayload = PayloadBase &
  Readonly<{
    family: "PROCEDURE";
    consequence: ProcedureRequirementConsequence;
  }>;

export type DocumentRequirementPayload = PayloadBase &
  Readonly<{
    family: "DOCUMENT_REQUIREMENT";
    consequence: Readonly<{
      forProcedure: ProcedureTargetSelector;
      documentTypeId: DocumentTypeId;
      issuingCountry: CountryTemplate | null;
      discriminator: string | null;
      requirement: RequirementValue;
    }>;
  }>;

export type DocumentFormalityPayload = PayloadBase &
  Readonly<{
    family: "DOCUMENT_FORMALITY";
    consequence: Readonly<{
      forDocument: DocumentTargetSelector;
      formalityCode: FormalityCode;
      requirement: RequirementValue;
    }>;
  }>;

export type DocumentReuseRulePayload = PayloadBase &
  Readonly<{
    family: "DOCUMENT_REUSE";
    consequence: Readonly<{
      forDocument: DocumentTargetSelector;
      /** REUSE_UNKNOWN is never authored: it is the absence of a rule. */
      resolution: Exclude<DocumentReuseResolution, "REUSE_UNKNOWN">;
    }>;
  }>;

export type DependencyRulePayload = PayloadBase &
  Readonly<{
    family: "DEPENDENCY";
    consequence: Readonly<{
      dependent: ProcedureTargetSelector;
      dependsOn: ProcedureTargetSelector;
      relation: "REQUIRED_BEFORE" | "NOT_REQUIRED_BEFORE";
    }>;
  }>;

export type FeeRulePayload = PayloadBase &
  Readonly<{
    family: "FEE";
    consequence: Readonly<{
      forProcedure: ProcedureTargetSelector;
      componentCode: FeeComponentCode;
      feeType: FeeType;
      formula: FeeFormulaTemplate;
    }>;
  }>;

export type WarningRulePayload = PayloadBase &
  Readonly<{
    family: "WARNING";
    consequence: Readonly<{
      code: WarningCode;
      severity: WarningSeverity;
      qualifier: string | null;
    }>;
  }>;

/**
 * Special-case rules exist so a case that would otherwise fall out of product
 * scope is recognised as a known special case first.
 */
export type SpecialCaseRulePayload = PayloadBase &
  Readonly<{
    family: "SPECIAL_CASE";
    consequence: Readonly<{
      specialCaseCode:
        | "PARAGUAYAN_CITIZENSHIP"
        | "MINOR"
        | "PARAGUAYAN_PARENT"
        | "PARAGUAYAN_SPOUSE"
        | "REPATRIADO_FAMILY"
        | "DIPLOMATIC"
        | "PROTECTION"
        | "INVESTOR";
    }>;
  }>;

export type TimelineRulePayload = PayloadBase &
  Readonly<{
    family: "TIMELINE";
    consequence: Readonly<{
      code: WarningCode;
      severity: WarningSeverity;
      qualifier: string | null;
    }>;
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
      return payload.consequence.kind === "CASE_TYPE" ? "CASE_TYPE" : "RESIDENCE_CLASSIFICATION";
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
    case "WARNING":
    case "TIMELINE":
      return ["CASE_LEGAL", "DOCUMENT_STATE", "ENTRY_READINESS"];
    case "CLASSIFICATION":
    case "SPECIAL_CASE":
    case "VISA":
    case "PROCEDURE":
    case "DOCUMENT_REQUIREMENT":
    case "DOCUMENT_FORMALITY":
    case "DEPENDENCY":
    case "FEE":
      return ["CASE_LEGAL"];
  }
}
