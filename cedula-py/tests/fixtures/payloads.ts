import type {
  ClassificationRulePayload,
  DependencyRulePayload,
  DocumentFormalityPayload,
  DocumentRequirementPayload,
  DocumentReuseRulePayload,
  FeeRulePayload,
  ProcedureParameterTemplate,
  ProcedureRulePayload,
  ProcedureTargetSelector,
  RequirementValue,
  VisaRulePayload,
  WarningRulePayload,
} from "../../src/rules/definitions/payloads";
import type { RuleConditionNode } from "../../src/rules/definitions/ast";
import type { CaseType } from "../../src/domain/case/classification";
import { alwaysTrue } from "./rules";
import { id } from "./ids";

/** Synthetic payload builders. None of these encode any real legal content. */
export function procedureSelector(
  procedureId: string,
  parameters: readonly ProcedureParameterTemplate[] | null = [],
  discriminator: string | null = null,
): ProcedureTargetSelector {
  return { procedureId: id(procedureId), parameters, discriminator };
}

export function literalParam(name: string, value: string): ProcedureParameterTemplate {
  return { name, value: { kind: "LITERAL", literal: { kind: "STRING", value } } };
}

export function factParam(name: string, path: ProcedureParameterTemplate["value"] extends never ? never : string): ProcedureParameterTemplate {
  return { name, value: { kind: "FACT", path: path as never } };
}

export function procedurePayload(
  procedureId: string,
  requirement: RequirementValue = "REQUIRED",
  condition: RuleConditionNode = alwaysTrue,
  parameters: readonly ProcedureParameterTemplate[] = [],
  discriminator: string | null = null,
): ProcedureRulePayload {
  return {
    family: "PROCEDURE",
    scope: "CASE",
    condition,
    consequence: { procedureId: id(procedureId), parameters, discriminator, requirement },
  };
}

export function documentPayload(
  procedureId: string,
  documentTypeId: string,
  requirement: RequirementValue = "REQUIRED",
  condition: RuleConditionNode = alwaysTrue,
  issuingCountry: string | null = null,
): DocumentRequirementPayload {
  return {
    family: "DOCUMENT_REQUIREMENT",
    scope: "CASE",
    condition,
    consequence: {
      forProcedure: procedureSelector(procedureId),
      documentTypeId: id(documentTypeId),
      issuingCountry: issuingCountry === null ? null : { kind: "LITERAL", countryCode: id(issuingCountry) },
      discriminator: null,
      requirement,
    },
  };
}

export function formalityPayload(
  procedureId: string,
  documentTypeId: string,
  formalityCode: string,
  requirement: RequirementValue = "REQUIRED",
  condition: RuleConditionNode = alwaysTrue,
): DocumentFormalityPayload {
  return {
    family: "DOCUMENT_FORMALITY",
    scope: "CASE",
    condition,
    consequence: {
      forDocument: {
        forProcedure: procedureSelector(procedureId),
        documentTypeId: id(documentTypeId),
        issuingCountry: null,
        discriminator: null,
      },
      formalityCode: id(formalityCode),
      requirement,
    },
  };
}

export function reusePayload(
  procedureId: string,
  documentTypeId: string,
  resolution: DocumentReuseRulePayload["consequence"]["resolution"],
  condition: RuleConditionNode = alwaysTrue,
): DocumentReuseRulePayload {
  return {
    family: "DOCUMENT_REUSE",
    scope: "CASE",
    condition,
    consequence: {
      forDocument: {
        forProcedure: procedureSelector(procedureId),
        documentTypeId: id(documentTypeId),
        issuingCountry: null,
        discriminator: null,
      },
      resolution,
    },
  };
}

export function dependencyPayload(
  dependent: string,
  dependsOn: string,
  relation: DependencyRulePayload["consequence"]["relation"] = "REQUIRED_BEFORE",
  condition: RuleConditionNode = alwaysTrue,
): DependencyRulePayload {
  return {
    family: "DEPENDENCY",
    scope: "CASE",
    condition,
    consequence: { dependent: procedureSelector(dependent), dependsOn: procedureSelector(dependsOn), relation },
  };
}

export function feePayload(
  procedureId: string,
  componentCode: string,
  formula: FeeRulePayload["consequence"]["formula"],
  condition: RuleConditionNode = alwaysTrue,
): FeeRulePayload {
  const feeType =
    formula.kind === "FIXED" ? "FIXED_AMOUNT" : formula.kind === "INDEXED" ? "INDEXED_AMOUNT" : "EXTERNAL_OR_VARIABLE";
  return {
    family: "FEE",
    scope: "CASE",
    condition,
    consequence: { forProcedure: procedureSelector(procedureId), componentCode: id(componentCode), feeType, formula },
  };
}

export function caseTypePayload(
  caseType: CaseType,
  condition: RuleConditionNode = alwaysTrue,
): ClassificationRulePayload {
  return {
    family: "CLASSIFICATION",
    scope: "CASE",
    condition,
    consequence: { kind: "CASE_TYPE", caseType },
  };
}

export function residencePayload(
  classification: "NONE" | "TEMPORAL" | "PERMANENT",
  condition: RuleConditionNode = alwaysTrue,
): ClassificationRulePayload {
  return {
    family: "CLASSIFICATION",
    scope: "CASE",
    condition,
    consequence: { kind: "RESIDENCE_CLASSIFICATION", classification },
  };
}

export function visaPayload(
  purposeCode: string,
  requirement: RequirementValue,
  condition: RuleConditionNode = alwaysTrue,
): VisaRulePayload {
  return {
    family: "VISA",
    scope: "CASE",
    condition,
    consequence: { purposeCode: id(purposeCode), requirement },
  };
}

export function warningPayload(
  code: WarningRulePayload["consequence"]["code"],
  severity: WarningRulePayload["consequence"]["severity"] = "INFO",
  qualifier: string | null = null,
  condition: RuleConditionNode = alwaysTrue,
): WarningRulePayload {
  return {
    family: "WARNING",
    scope: "CASE",
    condition,
    consequence: { code, severity, qualifier },
  };
}
