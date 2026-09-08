import { z } from "zod";
import { SLUG_PATTERN, UUID_PATTERN } from "../../domain/identifiers/identifiers";
import { KNOWLEDGE_STATES } from "../../domain/case/knowledge";
import { CASE_TYPES } from "../../domain/case/classification";
import { REPORTED_RESIDENCE_TYPES } from "../../domain/residence/residence";
import { PUBLICATION_STATUSES } from "../../domain/rules/publication";
import { VERIFICATION_STATUSES } from "../../domain/rules/verification";
import { FEE_TYPES } from "../../domain/fees/fee";
import { VERIFICATION_CODES, WARNING_CODES } from "../../domain/evaluation/issues";
import { COMPARE_OPERATORS, DATE_COMPARE_OPERATORS, TRUTH_VALUES } from "../definitions/ast";
import type { CalendarPeriod, DateExpression, RuleConditionNode } from "../definitions/ast";
import { ALL_RULE_FACT_PATHS } from "../definitions/fact-paths";
import { RULE_SCOPES } from "../definitions/scopes";
import type { RulePayload } from "../definitions/payloads";
import { PRECEDENCE_RELATIONS } from "../definitions/rule-revision";
import type { RuleRevision } from "../definitions/rule-revision";
import type { EvaluationBundleContent } from "../bundle/bundle-content";

/**
 * Wire-shape validation for rules.
 *
 * These schemas answer "is this a syntactically valid rule payload?". They do
 * not answer "is this rule semantically admissible?" - limits, fact access,
 * scope compatibility and operator/type compatibility are checked by
 * `structural-validation.ts`, because those questions need the registry.
 */
function brandedString<B>(pattern: RegExp): z.ZodType<B> {
  return z.string().regex(pattern) as unknown as z.ZodType<B>;
}

const slugSchema = <B>(): z.ZodType<B> => brandedString<B>(SLUG_PATTERN);
const uuidSchema = <B>(): z.ZodType<B> => brandedString<B>(UUID_PATTERN);
const localDateSchema = <B>(): z.ZodType<B> =>
  brandedString<B>(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u);
const schemaVersionSchema = <B>(): z.ZodType<B> => brandedString<B>(/^[a-z][a-z0-9-]*@\d+\.\d+$/u);
const currencySchema = <B>(): z.ZodType<B> => brandedString<B>(/^[A-Z]{3}$/u);
const countrySchema = <B>(): z.ZodType<B> => brandedString<B>(/^[A-Z]{2}$/u);

const factPathSchema = z.enum(ALL_RULE_FACT_PATHS as unknown as [string, ...string[]]);

const calendarPeriodSchema: z.ZodType<CalendarPeriod> = z.object({
  years: z.int().min(0).max(200),
  months: z.int().min(0).max(2400),
  days: z.int().min(0).max(100000),
}) as unknown as z.ZodType<CalendarPeriod>;

const dateExpressionSchema: z.ZodType<DateExpression> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("EFFECTIVE_DATE") }),
    z.object({ kind: z.literal("LITERAL_DATE"), value: localDateSchema<never>() }),
    z.object({ kind: z.literal("FACT_DATE"), path: factPathSchema }),
    z.object({
      kind: z.literal("SHIFTED"),
      base: dateExpressionSchema,
      direction: z.enum(["PLUS", "MINUS"]),
      period: calendarPeriodSchema,
    }),
  ]),
) as unknown as z.ZodType<DateExpression>;

const compareOperandSchema = z.union([
  z.object({ kind: z.literal("STRING"), value: z.string().min(1).max(128) }),
  z.object({ kind: z.literal("BOOLEAN"), value: z.boolean() }),
  z.object({ kind: z.literal("INTEGER"), value: z.int() }),
  z.object({
    kind: z.literal("STRING_SET"),
    values: z.array(z.string().min(1).max(128)).min(1).max(64),
  }),
]);

export const ruleConditionNodeSchema: z.ZodType<RuleConditionNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("CONSTANT"), value: z.enum(TRUTH_VALUES as unknown as [string, ...string[]]) }),
    z.object({ kind: z.literal("ALL"), children: z.array(ruleConditionNodeSchema) }),
    z.object({ kind: z.literal("ANY"), children: z.array(ruleConditionNodeSchema) }),
    z.object({ kind: z.literal("NOT"), child: ruleConditionNodeSchema }),
    z.object({
      kind: z.literal("FACT_STATE"),
      path: factPathSchema,
      states: z.array(z.enum(KNOWLEDGE_STATES as unknown as [string, ...string[]])).min(1).max(4),
    }),
    z.object({
      kind: z.literal("COMPARE"),
      path: factPathSchema,
      operator: z.enum(COMPARE_OPERATORS as unknown as [string, ...string[]]),
      operand: compareOperandSchema,
    }),
    z.object({
      kind: z.literal("DATE_COMPARE"),
      left: dateExpressionSchema,
      operator: z.enum(DATE_COMPARE_OPERATORS as unknown as [string, ...string[]]),
      right: dateExpressionSchema,
    }),
    z.object({
      kind: z.literal("INTERVAL_OVERLAP_AT_LEAST"),
      fromPath: factPathSchema,
      toPath: factPathSchema,
      within: z
        .object({ from: dateExpressionSchema, to: dateExpressionSchema })
        .nullable(),
      atLeast: calendarPeriodSchema,
    }),
  ]),
) as unknown as z.ZodType<RuleConditionNode>;

const procedureParameterValueSchema = z.union([
  z.object({ kind: z.literal("STRING"), value: z.string().min(1).max(128) }),
  z.object({ kind: z.literal("INTEGER"), value: z.int() }),
  z.object({ kind: z.literal("BOOLEAN"), value: z.boolean() }),
]);

const procedureParameterTemplateSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/u).max(48),
  value: z.union([
    z.object({ kind: z.literal("LITERAL"), literal: procedureParameterValueSchema }),
    z.object({ kind: z.literal("FACT"), path: factPathSchema }),
  ]),
});

const countryTemplateSchema = z.union([
  z.object({ kind: z.literal("LITERAL"), countryCode: countrySchema<never>() }),
  z.object({ kind: z.literal("FACT"), path: factPathSchema }),
]);

const discriminatorSchema = z.string().regex(SLUG_PATTERN).max(64).nullable();

const procedureTargetSelectorSchema = z.object({
  procedureId: slugSchema<never>(),
  parameters: z.array(procedureParameterTemplateSchema).max(16).nullable(),
  discriminator: discriminatorSchema,
});

const documentTargetSelectorSchema = z.object({
  forProcedure: procedureTargetSelectorSchema,
  documentTypeId: slugSchema<never>(),
  issuingCountry: countryTemplateSchema.nullable(),
  discriminator: discriminatorSchema,
});

const requirementSchema = z.enum(["REQUIRED", "NOT_REQUIRED"]);

const moneySchema = z.object({
  amountMinorUnits: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: currencySchema<never>(),
});

const payloadBase = {
  scope: z.enum(RULE_SCOPES as unknown as [string, ...string[]]),
  condition: ruleConditionNodeSchema,
};

export const rulePayloadSchema: z.ZodType<RulePayload> = z.union([
  z.object({
    ...payloadBase,
    family: z.literal("CLASSIFICATION"),
    consequence: z.union([
      z.object({
        kind: z.literal("CASE_TYPE"),
        caseType: z.enum(CASE_TYPES as unknown as [string, ...string[]]),
      }),
      z.object({
        kind: z.literal("RESIDENCE_CLASSIFICATION"),
        classification: z.enum(REPORTED_RESIDENCE_TYPES as unknown as [string, ...string[]]),
      }),
    ]),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("VISA"),
    consequence: z.object({ purposeCode: slugSchema<never>(), requirement: requirementSchema }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("PROCEDURE"),
    consequence: z.object({
      procedureId: slugSchema<never>(),
      parameters: z.array(procedureParameterTemplateSchema).max(16),
      discriminator: discriminatorSchema,
      requirement: requirementSchema,
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DOCUMENT_REQUIREMENT"),
    consequence: z.object({
      forProcedure: procedureTargetSelectorSchema,
      documentTypeId: slugSchema<never>(),
      issuingCountry: countryTemplateSchema.nullable(),
      discriminator: discriminatorSchema,
      requirement: requirementSchema,
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DOCUMENT_FORMALITY"),
    consequence: z.object({
      forDocument: documentTargetSelectorSchema,
      formalityCode: slugSchema<never>(),
      requirement: requirementSchema,
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DOCUMENT_REUSE"),
    consequence: z.object({
      forDocument: documentTargetSelectorSchema,
      resolution: z.enum(["REUSABLE_CONFIRMED", "REUSE_NOT_ALLOWED", "REISSUE_REQUIRED"]),
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DEPENDENCY"),
    consequence: z.object({
      dependent: procedureTargetSelectorSchema,
      dependsOn: procedureTargetSelectorSchema,
      relation: z.enum(["REQUIRED_BEFORE", "NOT_REQUIRED_BEFORE"]),
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("FEE"),
    consequence: z.object({
      forProcedure: procedureTargetSelectorSchema,
      componentCode: slugSchema<never>(),
      feeType: z.enum(FEE_TYPES as unknown as [string, ...string[]]),
      formula: z.union([
        z.object({ kind: z.literal("FIXED"), amount: moneySchema }),
        z.object({
          kind: z.literal("INDEXED"),
          multiplier: z.int().min(0).max(1000000),
          feeIndexId: slugSchema<never>(),
        }),
        z.object({ kind: z.literal("EXTERNAL_VARIABLE"), costCode: slugSchema<never>() }),
      ]),
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("WARNING"),
    consequence: z.object({
      code: z.enum(WARNING_CODES as unknown as [string, ...string[]]),
      severity: z.enum(["INFO", "CAUTION"]),
      qualifier: z.string().max(128).nullable(),
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("SPECIAL_CASE"),
    consequence: z.object({
      specialCaseCode: z.enum([
        "PARAGUAYAN_CITIZENSHIP",
        "MINOR",
        "PARAGUAYAN_PARENT",
        "PARAGUAYAN_SPOUSE",
        "REPATRIADO_FAMILY",
        "DIPLOMATIC",
        "PROTECTION",
        "INVESTOR",
      ]),
    }),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("TIMELINE"),
    consequence: z.object({
      code: z.enum(WARNING_CODES as unknown as [string, ...string[]]),
      severity: z.enum(["INFO", "CAUTION"]),
      qualifier: z.string().max(128).nullable(),
    }),
  }),
]) as unknown as z.ZodType<RulePayload>;

export const ruleRevisionSchema: z.ZodType<RuleRevision> = z.object({
  ruleRevisionId: uuidSchema<never>(),
  ruleId: slugSchema<never>(),
  ruleSetId: slugSchema<never>(),
  ruleSetRevisionId: uuidSchema<never>(),
  version: z.int().min(1),
  publicationStatus: z.enum(PUBLICATION_STATUSES as unknown as [string, ...string[]]),
  verificationStatus: z.enum(VERIFICATION_STATUSES as unknown as [string, ...string[]]),
  validFrom: localDateSchema<never>(),
  validUntil: localDateSchema<never>().nullable(),
  payloadSchemaVersion: schemaVersionSchema<never>(),
  payload: rulePayloadSchema,
  precedence: z.array(
    z.object({
      relation: z.enum(PRECEDENCE_RELATIONS as unknown as [string, ...string[]]),
      overRuleId: slugSchema<never>(),
    }),
  ).max(32),
  evidence: z.array(
    z.object({
      sourceRevisionId: uuidSchema<never>(),
      citationDetail: z.string().min(1).max(512),
    }),
  ).max(32),
  verification: z
    .object({
      code: z.enum(VERIFICATION_CODES as unknown as [string, ...string[]]),
      targetKind: z.enum(["CASE", "PROCEDURE", "DOCUMENT", "VISA_PURPOSE", "FEE_COMPONENT"]),
    })
    .nullable(),
}) as unknown as z.ZodType<RuleRevision>;

/* -------------------------------------------------------------------------- */
/* Evaluation bundle                                                           */
/* -------------------------------------------------------------------------- */

const effectiveWindow = {
  validFrom: localDateSchema<never>(),
  validUntil: localDateSchema<never>().nullable(),
};

const publicationStatusSchema = z.enum(PUBLICATION_STATUSES as unknown as [string, ...string[]]);

export const evaluationBundleContentSchema: z.ZodType<EvaluationBundleContent> = z.object({
  schemaVersion: schemaVersionSchema<never>(),
  ruleSetRevisions: z.array(
    z.object({
      ruleSetRevisionId: uuidSchema<never>(),
      ruleSetId: slugSchema<never>(),
      publicationStatus: publicationStatusSchema,
      ...effectiveWindow,
    }),
  ),
  ruleRevisions: z.array(ruleRevisionSchema),
  evidence: z.array(
    z.object({
      sourceRevisionId: uuidSchema<never>(),
      sourceId: slugSchema<never>(),
      publicationStatus: publicationStatusSchema,
      language: brandedString<never>(/^[a-z]{2}$/u),
      retrievedAt: brandedString<never>(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u),
      locator: z.string().min(1).max(2048),
    }),
  ),
  feeIndexRevisions: z.array(
    z.object({
      feeIndexRevisionId: uuidSchema<never>(),
      feeIndexId: slugSchema<never>(),
      publicationStatus: publicationStatusSchema,
      verificationStatus: z.enum(VERIFICATION_STATUSES as unknown as [string, ...string[]]),
      ...effectiveWindow,
      unitAmount: moneySchema,
    }),
  ),
  productPolicyRevisions: z.array(
    z.object({
      productPolicyRevisionId: uuidSchema<never>(),
      productPolicyId: slugSchema<never>(),
      publicationStatus: publicationStatusSchema,
      ...effectiveWindow,
      supportedDesiredProcedures: z.array(
        z.enum(["FIRST_CEDULA", "CEDULA_RENEWAL", "CEDULA_REPLACEMENT"]),
      ),
    }),
  ),
  productCoverageRevisions: z.array(
    z.object({
      productCoverageRevisionId: uuidSchema<never>(),
      productCoverageId: slugSchema<never>(),
      publicationStatus: publicationStatusSchema,
      ...effectiveWindow,
      countryCode: countrySchema<never>(),
      desiredProcedure: z.enum(["FIRST_CEDULA", "CEDULA_RENEWAL", "CEDULA_REPLACEMENT"]),
      state: z.enum(["SUPPORTED", "PARTIAL", "NOT_SUPPORTED", "RESEARCH_REQUIRED"]),
    }),
  ),
  pathwayDefinitionRevisions: z.array(
    z.object({
      pathwayDefinitionRevisionId: uuidSchema<never>(),
      pathwayDefinitionId: slugSchema<never>(),
      pathwayId: slugSchema<never>(),
      publicationStatus: publicationStatusSchema,
      ...effectiveWindow,
      appliesToCaseTypes: z.array(z.enum(CASE_TYPES as unknown as [string, ...string[]])),
      sections: z.array(
        z.object({
          sectionKey: z.string().min(1).max(64),
          order: z.int().min(0).max(1000),
          procedureKeyPatterns: z.array(z.string().min(1).max(256)).max(64),
        }),
      ),
    }),
  ),
}) as unknown as z.ZodType<EvaluationBundleContent>;
