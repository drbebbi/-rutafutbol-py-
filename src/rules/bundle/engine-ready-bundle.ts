import { err, ok, type Result } from "../../shared/result/result";
import type { LocalDate } from "../../domain/primitives/local-date";
import type { Sha256Hex } from "../../domain/primitives/hash";
import type { FeeIndexRevision } from "../../domain/fees/fee";
import type {
  PathwayDefinitionRevision,
  ProductCoverageRevision,
  ProductPolicyRevision,
} from "../../domain/product/product";
import type { SourceRevision } from "../../domain/sources/source";
import { isBundleEligible } from "../../domain/rules/publication";
import type { RuleRevision } from "../definitions/rule-revision";
import { RULE_PAYLOAD_SCHEMA_VERSION } from "../definitions/rule-revision";
import { validateRuleRevisionStructure, type RuleValidationIssue } from "../validation/structural-validation";
import { validatePrecedenceGraph, type PrecedenceIssue } from "../conflicts/precedence-validation";
import { EVALUATION_BUNDLE_SCHEMA_VERSION, type EvaluationBundleContent } from "./bundle-content";
import { evaluationBundleContentHash } from "./canonical-bundle";

export type BundleValidationIssue =
  | Readonly<{ kind: "RULE"; issue: RuleValidationIssue }>
  | Readonly<{ kind: "PRECEDENCE"; issue: PrecedenceIssue }>
  | Readonly<{ kind: "BUNDLE"; code: BundleIssueCode; detail: string }>;

export type BundleIssueCode =
  | "UNSUPPORTED_BUNDLE_SCHEMA_VERSION"
  | "UNSUPPORTED_RULE_PAYLOAD_VERSION"
  | "INELIGIBLE_PUBLICATION_STATUS"
  | "RULE_OUTSIDE_EFFECTIVE_WINDOW"
  | "DUPLICATE_RULE_IDENTITY"
  | "MISSING_EVIDENCE_SOURCE_REVISION"
  | "OVERLAPPING_FEE_INDEX_REVISIONS";

/**
 * A validated, indexed bundle. The engine only ever sees this shape, so it
 * never has to re-derive eligibility, re-check schema versions or scan arrays
 * for lookups.
 *
 * `effectiveLocalDate` is carried explicitly: the bundle was assembled *for*
 * one legal cut-off date, and the engine refuses to run against a context with
 * a different one.
 */
export type EngineReadyBundleContent = Readonly<{
  contentHash: Sha256Hex;
  effectiveLocalDate: LocalDate;
  ruleRevisions: readonly RuleRevision[];
  ruleRevisionByRuleId: ReadonlyMap<string, RuleRevision>;
  evidenceBySourceRevisionId: ReadonlyMap<string, SourceRevision>;
  feeIndexRevisions: readonly FeeIndexRevision[];
  productPolicyRevisions: readonly ProductPolicyRevision[];
  productCoverageRevisions: readonly ProductCoverageRevision[];
  pathwayDefinitionRevisions: readonly PathwayDefinitionRevision[];
}>;

function withinWindow(validFrom: LocalDate, validUntil: LocalDate | null, on: LocalDate): boolean {
  const date = on as string;
  if (date < (validFrom as string)) {
    return false;
  }
  return validUntil === null || date <= (validUntil as string);
}

/**
 * Validates a bundle and turns it into engine-ready form.
 *
 * Every rule is checked structurally, the precedence graph is checked for
 * cycles and family mismatches, and the eligibility window is applied for the
 * *same* effective date the engine will use.
 */
export function prepareEngineReadyBundle(
  content: EvaluationBundleContent,
  effectiveLocalDate: LocalDate,
): Result<EngineReadyBundleContent, readonly BundleValidationIssue[]> {
  const issues: BundleValidationIssue[] = [];

  if ((content.schemaVersion as string) !== (EVALUATION_BUNDLE_SCHEMA_VERSION as string)) {
    issues.push({
      kind: "BUNDLE",
      code: "UNSUPPORTED_BUNDLE_SCHEMA_VERSION",
      detail: `bundle schema ${content.schemaVersion} is not ${EVALUATION_BUNDLE_SCHEMA_VERSION}`,
    });
  }

  const evidenceIndex = new Map<string, SourceRevision>();
  for (const revision of content.evidence) {
    evidenceIndex.set(revision.sourceRevisionId as string, revision);
  }

  const eligible: RuleRevision[] = [];
  const seenRuleIds = new Set<string>();

  for (const revision of content.ruleRevisions) {
    if ((revision.payloadSchemaVersion as string) !== (RULE_PAYLOAD_SCHEMA_VERSION as string)) {
      issues.push({
        kind: "BUNDLE",
        code: "UNSUPPORTED_RULE_PAYLOAD_VERSION",
        detail: `rule "${revision.ruleId}" uses payload schema ${revision.payloadSchemaVersion}`,
      });
      continue;
    }
    if (!isBundleEligible(revision.publicationStatus)) {
      issues.push({
        kind: "BUNDLE",
        code: "INELIGIBLE_PUBLICATION_STATUS",
        detail: `rule "${revision.ruleId}" is ${revision.publicationStatus}`,
      });
      continue;
    }
    if (!withinWindow(revision.validFrom, revision.validUntil, effectiveLocalDate)) {
      issues.push({
        kind: "BUNDLE",
        code: "RULE_OUTSIDE_EFFECTIVE_WINDOW",
        detail: `rule "${revision.ruleId}" is not effective on ${effectiveLocalDate}`,
      });
      continue;
    }
    if (seenRuleIds.has(revision.ruleId as string)) {
      issues.push({
        kind: "BUNDLE",
        code: "DUPLICATE_RULE_IDENTITY",
        detail: `two revisions of rule "${revision.ruleId}" are effective on ${effectiveLocalDate}`,
      });
      continue;
    }
    seenRuleIds.add(revision.ruleId as string);

    for (const structuralIssue of validateRuleRevisionStructure(revision)) {
      issues.push({ kind: "RULE", issue: structuralIssue });
    }
    for (const evidence of revision.evidence) {
      if (!evidenceIndex.has(evidence.sourceRevisionId as string)) {
        issues.push({
          kind: "BUNDLE",
          code: "MISSING_EVIDENCE_SOURCE_REVISION",
          detail: `rule "${revision.ruleId}" cites source revision ${evidence.sourceRevisionId}, which is not in the bundle`,
        });
      }
    }
    eligible.push(revision);
  }

  for (const precedenceIssue of validatePrecedenceGraph(eligible)) {
    issues.push({ kind: "PRECEDENCE", issue: precedenceIssue });
  }

  // A fee index must resolve to exactly one revision per date; overlapping
  // windows are a knowledge-base defect, not something to tie-break at runtime.
  const feeIndexWindows = new Map<string, FeeIndexRevision[]>();
  for (const revision of content.feeIndexRevisions) {
    const list = feeIndexWindows.get(revision.feeIndexId as string) ?? [];
    list.push(revision);
    feeIndexWindows.set(revision.feeIndexId as string, list);
  }
  for (const [feeIndexId, revisions] of [...feeIndexWindows.entries()].sort()) {
    const applicable = revisions.filter(
      (revision) =>
        isBundleEligible(revision.publicationStatus) &&
        withinWindow(revision.validFrom, revision.validUntil, effectiveLocalDate),
    );
    if (applicable.length > 1) {
      issues.push({
        kind: "BUNDLE",
        code: "OVERLAPPING_FEE_INDEX_REVISIONS",
        detail: `fee index "${feeIndexId}" has ${applicable.length} revisions effective on ${effectiveLocalDate}`,
      });
    }
  }

  if (issues.length > 0) {
    return err(issues);
  }

  const sorted = [...eligible].sort((a, b) =>
    (a.ruleId as string) < (b.ruleId as string) ? -1 : (a.ruleId as string) > (b.ruleId as string) ? 1 : 0,
  );

  return ok({
    contentHash: evaluationBundleContentHash(content),
    effectiveLocalDate,
    ruleRevisions: sorted,
    ruleRevisionByRuleId: new Map(sorted.map((revision) => [revision.ruleId as string, revision])),
    evidenceBySourceRevisionId: evidenceIndex,
    feeIndexRevisions: [...content.feeIndexRevisions].sort((a, b) =>
      (a.feeIndexRevisionId as string) < (b.feeIndexRevisionId as string) ? -1 : 1,
    ),
    productPolicyRevisions: content.productPolicyRevisions,
    productCoverageRevisions: content.productCoverageRevisions,
    pathwayDefinitionRevisions: content.pathwayDefinitionRevisions,
  });
}
