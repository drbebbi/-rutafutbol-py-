import type { RuleId } from "../../domain/identifiers/identifiers";
import { isSupportLevel } from "../../domain/rules/verification";
import {
  AST_MAX_BOOLEAN_CHILDREN,
  AST_MAX_DEPTH,
  AST_MAX_NODES,
} from "../definitions/limits";
import type { CompareOperator, DateExpression, RuleConditionNode } from "../definitions/ast";
import {
  lookupFactPath,
  type FactAccessDomain,
  type RuleFactPath,
  type RuleFactValueType,
} from "../definitions/fact-paths";
import { allowedPathScopesFor, type RuleScope } from "../definitions/scopes";
import {
  allowedAccessDomainsForFamily,
  type CountryTemplate,
  type ProcedureParameterTemplate,
  type ProcedureTargetSelector,
  type RuleFamily,
  type RulePayload,
} from "../definitions/payloads";
import { RULE_PAYLOAD_SCHEMA_VERSION, type RuleRevision } from "../definitions/rule-revision";

export type RuleValidationIssueCode =
  | "UNSUPPORTED_PAYLOAD_SCHEMA_VERSION"
  | "AST_DEPTH_EXCEEDED"
  | "AST_NODE_COUNT_EXCEEDED"
  | "AST_BOOLEAN_CHILDREN_EXCEEDED"
  | "AST_EMPTY_BOOLEAN_NODE"
  | "UNKNOWN_FACT_PATH"
  | "FACT_PATH_SCOPE_MISMATCH"
  | "FACT_ACCESS_DOMAIN_FORBIDDEN"
  | "OPERATOR_TYPE_MISMATCH"
  | "DATE_EXPRESSION_TYPE_MISMATCH"
  | "INTERVAL_PATH_TYPE_MISMATCH"
  | "INTERVAL_PATH_SCOPE_MISMATCH"
  | "MISSING_EVIDENCE"
  | "MISSING_VERIFICATION_DECLARATION"
  | "UNEXPECTED_VERIFICATION_DECLARATION"
  | "INVALID_EFFECTIVE_WINDOW"
  | "SELF_PRECEDENCE"
  | "DUPLICATE_PRECEDENCE_EDGE";

export type RuleValidationIssue = Readonly<{
  code: RuleValidationIssueCode;
  ruleId: RuleId;
  detail: string;
}>;

/** Which operators are admissible for which fact value type. */
const OPERATOR_MATRIX: Readonly<Record<RuleFactValueType, readonly CompareOperator[]>> = {
  STRING: ["EQ", "NEQ", "IN", "NOT_IN"],
  BOOLEAN: ["EQ", "NEQ"],
  INTEGER: ["EQ", "NEQ", "COUNT_EQ", "COUNT_GTE", "COUNT_LTE"],
  STRING_SET: ["CONTAINS_ANY", "CONTAINS_ALL"],
  // Dates are compared with DATE_COMPARE, which understands calendar
  // semantics; allowing them here would invite string comparison of dates.
  LOCAL_DATE: [],
};

const OPERAND_MATRIX: Readonly<Record<CompareOperator, readonly string[]>> = {
  EQ: ["STRING", "BOOLEAN", "INTEGER"],
  NEQ: ["STRING", "BOOLEAN", "INTEGER"],
  IN: ["STRING_SET"],
  NOT_IN: ["STRING_SET"],
  CONTAINS_ANY: ["STRING_SET"],
  CONTAINS_ALL: ["STRING_SET"],
  COUNT_EQ: ["INTEGER"],
  COUNT_GTE: ["INTEGER"],
  COUNT_LTE: ["INTEGER"],
};

type Ctx = Readonly<{
  ruleId: RuleId;
  scope: RuleScope;
  family: RuleFamily;
  issues: RuleValidationIssue[];
}>;

function push(ctx: Ctx, code: RuleValidationIssueCode, detail: string): void {
  ctx.issues.push({ code, ruleId: ctx.ruleId, detail });
}

function checkPathAccess(ctx: Ctx, path: RuleFactPath, expected: readonly RuleFactValueType[] | null): void {
  const descriptor = lookupFactPath(path);
  if (descriptor === null) {
    push(ctx, "UNKNOWN_FACT_PATH", `path "${path}" is not registered`);
    return;
  }
  if (!allowedPathScopesFor(ctx.scope).includes(descriptor.pathScope)) {
    push(
      ctx,
      "FACT_PATH_SCOPE_MISMATCH",
      `path "${path}" (${descriptor.pathScope}) is not readable in scope ${ctx.scope}`,
    );
  }
  const allowedDomains: readonly FactAccessDomain[] = allowedAccessDomainsForFamily(ctx.family);
  if (!allowedDomains.includes(descriptor.accessDomain)) {
    push(
      ctx,
      "FACT_ACCESS_DOMAIN_FORBIDDEN",
      `family ${ctx.family} may not read ${descriptor.accessDomain} path "${path}"`,
    );
  }
  if (expected !== null && !expected.includes(descriptor.valueType)) {
    push(
      ctx,
      "OPERATOR_TYPE_MISMATCH",
      `path "${path}" has type ${descriptor.valueType}, expected one of ${expected.join("|")}`,
    );
  }
}

function walkDateExpression(ctx: Ctx, expression: DateExpression, depth: number): number {
  switch (expression.kind) {
    case "EFFECTIVE_DATE":
    case "LITERAL_DATE":
      return depth;
    case "FACT_DATE":
      checkPathAccess(ctx, expression.path, ["LOCAL_DATE"]);
      return depth;
    case "SHIFTED":
      return walkDateExpression(ctx, expression.base, depth + 1);
  }
}

function walkCondition(ctx: Ctx, node: RuleConditionNode, depth: number, counter: { n: number }): void {
  counter.n += 1;
  if (depth > AST_MAX_DEPTH) {
    push(ctx, "AST_DEPTH_EXCEEDED", `depth ${depth} exceeds ${AST_MAX_DEPTH}`);
    return;
  }
  if (counter.n > AST_MAX_NODES) {
    push(ctx, "AST_NODE_COUNT_EXCEEDED", `more than ${AST_MAX_NODES} nodes`);
    return;
  }

  switch (node.kind) {
    case "CONSTANT":
      return;
    case "ALL":
    case "ANY": {
      if (node.children.length === 0) {
        push(ctx, "AST_EMPTY_BOOLEAN_NODE", `${node.kind} node has no children`);
        return;
      }
      if (node.children.length > AST_MAX_BOOLEAN_CHILDREN) {
        push(
          ctx,
          "AST_BOOLEAN_CHILDREN_EXCEEDED",
          `${node.kind} has ${node.children.length} children, max ${AST_MAX_BOOLEAN_CHILDREN}`,
        );
        return;
      }
      for (const child of node.children) {
        walkCondition(ctx, child, depth + 1, counter);
      }
      return;
    }
    case "NOT":
      walkCondition(ctx, node.child, depth + 1, counter);
      return;
    case "FACT_STATE":
      checkPathAccess(ctx, node.path, null);
      return;
    case "COMPARE": {
      const descriptor = lookupFactPath(node.path);
      checkPathAccess(ctx, node.path, null);
      if (descriptor !== null) {
        const allowed = OPERATOR_MATRIX[descriptor.valueType];
        if (!allowed.includes(node.operator)) {
          push(
            ctx,
            "OPERATOR_TYPE_MISMATCH",
            `operator ${node.operator} is not valid for ${descriptor.valueType} path "${node.path}"`,
          );
        }
        const allowedOperands = OPERAND_MATRIX[node.operator];
        if (!allowedOperands.includes(node.operand.kind)) {
          push(
            ctx,
            "OPERATOR_TYPE_MISMATCH",
            `operator ${node.operator} does not accept a ${node.operand.kind} operand`,
          );
        }
        if (
          (descriptor.valueType === "STRING" || descriptor.valueType === "STRING_SET") &&
          (node.operand.kind === "INTEGER" || node.operand.kind === "BOOLEAN")
        ) {
          push(ctx, "OPERATOR_TYPE_MISMATCH", `path "${node.path}" cannot be compared to ${node.operand.kind}`);
        }
        if (descriptor.valueType === "BOOLEAN" && node.operand.kind !== "BOOLEAN") {
          push(ctx, "OPERATOR_TYPE_MISMATCH", `boolean path "${node.path}" needs a boolean operand`);
        }
        if (descriptor.valueType === "INTEGER" && node.operand.kind !== "INTEGER") {
          push(ctx, "OPERATOR_TYPE_MISMATCH", `integer path "${node.path}" needs an integer operand`);
        }
      }
      return;
    }
    case "DATE_COMPARE":
      walkDateExpression(ctx, node.left, depth + 1);
      walkDateExpression(ctx, node.right, depth + 1);
      return;
    case "INTERVAL_OVERLAP_AT_LEAST": {
      const from = lookupFactPath(node.fromPath);
      const to = lookupFactPath(node.toPath);
      checkPathAccess(ctx, node.fromPath, ["LOCAL_DATE"]);
      checkPathAccess(ctx, node.toPath, ["LOCAL_DATE"]);
      if (from !== null && to !== null && from.pathScope !== to.pathScope) {
        push(
          ctx,
          "INTERVAL_PATH_SCOPE_MISMATCH",
          `interval endpoints must come from the same scope (${from.pathScope} vs ${to.pathScope})`,
        );
      }
      if (node.within !== null) {
        walkDateExpression(ctx, node.within.from, depth + 1);
        walkDateExpression(ctx, node.within.to, depth + 1);
      }
      return;
    }
  }
}

function checkParameterTemplates(
  ctx: Ctx,
  templates: readonly ProcedureParameterTemplate[] | null,
): void {
  if (templates === null) {
    return;
  }
  for (const template of templates) {
    if (template.value.kind === "FACT") {
      checkPathAccess(ctx, template.value.path, ["STRING", "BOOLEAN", "INTEGER"]);
    }
  }
}

function checkCountryTemplate(ctx: Ctx, template: CountryTemplate | null): void {
  if (template !== null && template.kind === "FACT") {
    checkPathAccess(ctx, template.path, ["STRING"]);
  }
}

function checkProcedureSelector(ctx: Ctx, selector: ProcedureTargetSelector): void {
  checkParameterTemplates(ctx, selector.parameters);
}

function checkConsequenceTemplates(ctx: Ctx, payload: RulePayload): void {
  switch (payload.family) {
    case "PROCEDURE":
      checkParameterTemplates(ctx, payload.consequence.parameters);
      return;
    case "DOCUMENT_REQUIREMENT":
      checkProcedureSelector(ctx, payload.consequence.forProcedure);
      checkCountryTemplate(ctx, payload.consequence.issuingCountry);
      return;
    case "DOCUMENT_FORMALITY":
      checkProcedureSelector(ctx, payload.consequence.forDocument.forProcedure);
      checkCountryTemplate(ctx, payload.consequence.forDocument.issuingCountry);
      return;
    case "DOCUMENT_REUSE":
      checkProcedureSelector(ctx, payload.consequence.forDocument.forProcedure);
      checkCountryTemplate(ctx, payload.consequence.forDocument.issuingCountry);
      return;
    case "DEPENDENCY":
      checkProcedureSelector(ctx, payload.consequence.dependent);
      checkProcedureSelector(ctx, payload.consequence.dependsOn);
      return;
    case "FEE":
      checkProcedureSelector(ctx, payload.consequence.forProcedure);
      return;
    case "CLASSIFICATION":
    case "SPECIAL_CASE":
    case "VISA":
    case "WARNING":
    case "TIMELINE":
      return;
  }
}

/**
 * Full structural validation of one rule revision.
 *
 * Returns every issue found rather than the first, so a reviewer sees the
 * whole picture in one publication attempt.
 */
export function validateRuleRevisionStructure(revision: RuleRevision): readonly RuleValidationIssue[] {
  const ctx: Ctx = {
    ruleId: revision.ruleId,
    scope: revision.payload.scope,
    family: revision.payload.family,
    issues: [],
  };

  if ((revision.payloadSchemaVersion as string) !== (RULE_PAYLOAD_SCHEMA_VERSION as string)) {
    push(
      ctx,
      "UNSUPPORTED_PAYLOAD_SCHEMA_VERSION",
      `payload schema ${revision.payloadSchemaVersion} is not ${RULE_PAYLOAD_SCHEMA_VERSION}`,
    );
  }

  walkCondition(ctx, revision.payload.condition, 1, { n: 0 });
  checkConsequenceTemplates(ctx, revision.payload);

  if (isSupportLevel(revision.verificationStatus)) {
    if (revision.evidence.length === 0) {
      push(
        ctx,
        "MISSING_EVIDENCE",
        `${revision.verificationStatus} rule must cite at least one source revision`,
      );
    }
    if (revision.verification !== null) {
      push(
        ctx,
        "UNEXPECTED_VERIFICATION_DECLARATION",
        "a resolved rule must not carry a verification declaration",
      );
    }
  } else if (revision.verification === null) {
    push(
      ctx,
      "MISSING_VERIFICATION_DECLARATION",
      `${revision.verificationStatus} rule must declare what needs verification`,
    );
  }

  if (revision.validUntil !== null && (revision.validUntil as string) < (revision.validFrom as string)) {
    push(
      ctx,
      "INVALID_EFFECTIVE_WINDOW",
      `validUntil ${revision.validUntil} precedes validFrom ${revision.validFrom}`,
    );
  }

  const seenEdges = new Set<string>();
  for (const edge of revision.precedence) {
    if ((edge.overRuleId as string) === (revision.ruleId as string)) {
      push(ctx, "SELF_PRECEDENCE", "a rule cannot take precedence over itself");
    }
    const key = `${edge.relation}:${edge.overRuleId as string}`;
    if (seenEdges.has(key)) {
      push(ctx, "DUPLICATE_PRECEDENCE_EDGE", `duplicate precedence edge ${key}`);
    }
    seenEdges.add(key);
  }

  return ctx.issues;
}
