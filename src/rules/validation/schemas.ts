import { z } from "zod";
import { SLUG_PATTERN, UUID_PATTERN } from "../../domain/identifiers/identifiers";
import { KNOWLEDGE_STATES } from "../../domain/case/knowledge";
import { CASE_TYPES } from "../../domain/case/classification";
import { REPORTED_RESIDENCE_TYPES } from "../../domain/residence/residence";
import { PUBLICATION_STATUSES } from "../../domain/rules/publication";
import { UNRESOLVED_REASONS, VERIFICATION_STATUSES } from "../../domain/rules/verification";
import { FEE_TYPES } from "../../domain/fees/fee";
import { EVIDENCE_ROLES, SOURCE_CONFIDENCES } from "../../domain/sources/source";
import {
  BLOCKING_ISSUE_CODES,
  VERIFICATION_CODES,
  WARNING_CODES,
} from "../../domain/evaluation/issues";
import {
  PRODUCT_BLOCKER_CODES,
  PRODUCT_COVERAGE_STATES,
  PRODUCT_WARNING_CODES,
} from "../../domain/product/product";
import { COMPARE_OPERATORS, DATE_COMPARE_OPERATORS, TRUTH_VALUES } from "../definitions/ast";
import type { CalendarPeriod, DateExpression, RuleConditionNode } from "../definitions/ast";
import { ALL_RULE_FACT_PATHS } from "../definitions/fact-paths";
import { RULE_SCOPES } from "../definitions/scopes";
import { PRECEDENCE_RELATIONS, SPECIAL_CASE_CODES } from "../definitions/payloads";
import type { RulePayload } from "../definitions/payloads";
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

const verificationTargetTemplateSchema = z.union([
  z.object({ kind: z.literal("CASE") }),
  z.object({ kind: z.literal("PROCEDURE"), targetProcedure: procedureTargetSelectorSchema }),
  z.object({ kind: z.literal("DOCUMENT"), targetDocument: documentTargetSelectorSchema }),
  z.object({ kind: z.literal("VISA_PURPOSE"), purposeCode: slugSchema<never>() }),
  z.object({
    kind: z.literal("FEE_COMPONENT"),
    targetProcedure: procedureTargetSelectorSchema,
    componentCode: slugSchema<never>(),
  }),
]);

const unresolvedRuleVerificationSchema = z.object({
  code: z.enum(VERIFICATION_CODES as unknown as [string, ...string[]]),
  target: verificationTargetTemplateSchema,
});

const payloadBase = {
  scope: z.enum(RULE_SCOPES as unknown as [string, ...string[]]),
  condition: ruleConditionNodeSchema,
  precedence: z
    .array(
      z.object({
        relation: z.enum(PRECEDENCE_RELATIONS as unknown as [string, ...string[]]),
        overRuleId: slugSchema<never>(),
      }),
    )
    .max(32),
};

/**
 * A rule either states a consequence or asks for verification.
 *
 * The union is closed at the wire level too: there is no shape in which a
 * payload can carry both, so a malformed rule that tried to smuggle a
 * consequence past an UNRESOLVED state is rejected before it reaches the
 * domain.
 */
function resolutionSchema<T extends z.ZodTypeAny>(consequence: T) {
  return z.union([
    z.object({ state: z.literal("RESOLVED"), consequence }),
    z.object({
      state: z.literal("UNRESOLVED"),
      reason: z.enum(UNRESOLVED_REASONS as unknown as [string, ...string[]]),
      verification: unresolvedRuleVerificationSchema,
    }),
  ]);
}

export const rulePayloadSchema: z.ZodType<RulePayload> = z.union([
  z.object({
    ...payloadBase,
    family: z.literal("CLASSIFICATION"),
    subject: z.enum(["CASE_TYPE", "RESIDENCE_CLASSIFICATION"]),
    resolution: resolutionSchema(
      z.union([
        z.object({
          kind: z.literal("CASE_TYPE"),
          caseType: z.enum(CASE_TYPES as unknown as [string, ...string[]]),
        }),
        z.object({
          kind: z.literal("RESIDENCE_CLASSIFICATION"),
          classification: z.enum(REPORTED_RESIDENCE_TYPES as unknown as [string, ...string[]]),
        }),
      ]),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("VISA"),
    resolution: resolutionSchema(
      z.object({ purposeCode: slugSchema<never>(), requirement: requirementSchema }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("PROCEDURE"),
    resolution: resolutionSchema(
      z.object({
        procedureId: slugSchema<never>(),
        parameters: z.array(procedureParameterTemplateSchema).max(16),
        discriminator: discriminatorSchema,
        requirement: requirementSchema,
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DOCUMENT_REQUIREMENT"),
    resolution: resolutionSchema(
      z.object({
        forProcedure: procedureTargetSelectorSchema,
        documentTypeId: slugSchema<never>(),
        issuingCountry: countryTemplateSchema.nullable(),
        discriminator: discriminatorSchema,
        requirement: requirementSchema,
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DOCUMENT_FORMALITY"),
    resolution: resolutionSchema(
      z.object({
        forDocument: documentTargetSelectorSchema,
        formalityCode: slugSchema<never>(),
        requirement: requirementSchema,
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DOCUMENT_REUSE"),
    resolution: resolutionSchema(
      z.object({
        forDocument: documentTargetSelectorSchema,
        resolution: z.enum(["REUSABLE_CONFIRMED", "REUSE_NOT_ALLOWED", "REISSUE_REQUIRED"]),
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("DEPENDENCY"),
    resolution: resolutionSchema(
      z.object({
        dependent: procedureTargetSelectorSchema,
        dependsOn: procedureTargetSelectorSchema,
        relation: z.enum(["REQUIRED_BEFORE", "NOT_REQUIRED_BEFORE"]),
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("FEE"),
    resolution: resolutionSchema(
      z.object({
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
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("WARNING"),
    resolution: resolutionSchema(
      z.object({
        code: z.enum(WARNING_CODES as unknown as [string, ...string[]]),
        severity: z.enum(["INFO", "CAUTION"]),
        qualifier: z.string().max(128).nullable(),
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("SPECIAL_CASE"),
    resolution: resolutionSchema(
      z.object({
        specialCaseCode: z.enum(SPECIAL_CASE_CODES as unknown as [string, ...string[]]),
      }),
    ),
  }),
  z.object({
    ...payloadBase,
    family: z.literal("TIMELINE"),
    resolution: resolutionSchema(
      z.object({
        code: z.enum(WARNING_CODES as unknown as [string, ...string[]]),
        severity: z.enum(["INFO", "CAUTION"]),
        qualifier: z.string().max(128).nullable(),
      }),
    ),
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
  evidence: z.array(
    z.object({
      sourceRevisionId: uuidSchema<never>(),
      role: z.enum(EVIDENCE_ROLES as unknown as [string, ...string[]]),
      claimSummary: z.string().min(1).max(1024),
      citationDetail: z.string().min(1).max(512),
      quote: z.string().max(2048).nullable(),
    }),
  ).max(32),
}) as unknown as z.ZodType<RuleRevision>;

/* -------------------------------------------------------------------------- */
/* Evaluation bundle                                                           */
/* -------------------------------------------------------------------------- */

const effectiveWindow = {
  validFrom: localDateSchema<never>(),
  validUntil: localDateSchema<never>().nullable(),
};

const publicationStatusSchema = z.enum(PUBLICATION_STATUSES as unknown as [string, ...string[]]);

const desiredProcedureSchema = z.enum(["FIRST_CEDULA", "CEDULA_RENEWAL", "CEDULA_REPLACEMENT"]);

/**
 * The closed product policy effect vocabulary, at the wire level.
 *
 * Nothing here can name a procedure, a document, a formality or a fee: a
 * malformed policy that tried to smuggle one in is rejected before it reaches
 * the domain, not caught later by convention.
 */
const productPolicyEffectSchema = z.union([
  z.object({
    kind: z.literal("UNSUPPORTED"),
    blocker: z.enum(PRODUCT_BLOCKER_CODES as unknown as [string, ...string[]]),
  }),
  z.object({
    kind: z.literal("VERIFICATION_REQUIRED"),
    code: z.enum(VERIFICATION_CODES as unknown as [string, ...string[]]),
  }),
  z.object({
    kind: z.literal("BLOCKING"),
    code: z.enum(BLOCKING_ISSUE_CODES as unknown as [string, ...string[]]),
  }),
  z.object({
    kind: z.literal("WARNING"),
    code: z.enum(PRODUCT_WARNING_CODES as unknown as [string, ...string[]]),
  }),
]);

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
      publishedAt: localDateSchema<never>().nullable(),
      retrievedAt: brandedString<never>(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u),
      effectiveFrom: localDateSchema<never>().nullable(),
      effectiveUntil: localDateSchema<never>().nullable(),
      supersedes: uuidSchema<never>().nullable(),
      confidence: z.enum(SOURCE_CONFIDENCES as unknown as [string, ...string[]]),
      notes: z.string().max(4096).nullable(),
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
      payloadSchemaVersion: schemaVersionSchema<never>(),
      payload: z.object({
        supportedDesiredProcedures: z.array(desiredProcedureSchema),
        rules: z
          .array(
            z.object({
              policyRuleKey: z.string().min(1).max(64),
              condition: z.object({
                coverageStates: z.array(
                  z.enum(PRODUCT_COVERAGE_STATES as unknown as [string, ...string[]]),
                ),
                desiredProcedures: z.array(desiredProcedureSchema),
                countries: z.array(countrySchema<never>()),
                caseTypes: z.array(z.enum(CASE_TYPES as unknown as [string, ...string[]])),
              }),
              effect: productPolicyEffectSchema,
            }),
          )
          .max(64),
      }),
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
      payloadSchemaVersion: schemaVersionSchema<never>(),
      payload: z.object({
        appliesToCaseTypes: z.array(z.enum(CASE_TYPES as unknown as [string, ...string[]])),
        sections: z.array(
          z.object({
            sectionKey: z.string().min(1).max(64),
            order: z.int().min(0).max(1000),
            procedureKeyPatterns: z.array(z.string().min(1).max(256)).max(64),
          }),
        ),
      }),
    }),
  ),
}) as unknown as z.ZodType<EvaluationBundleContent>;
