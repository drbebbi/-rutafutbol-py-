import { err, ok, type Result } from "../../shared/result/result";
import type { CountryCode } from "../../domain/primitives/country";
import type { CaseType } from "../../domain/case/classification";
import type { DesiredProcedure } from "../../domain/case/user-case-facts";
import type {
  AppliedProductPolicyEffect,
  ProductCoverageDecision,
  ProductCoverageState,
  ProductPolicyCondition,
  ProductPolicyRevision,
  ProductPolicyRule,
} from "../../domain/product/product";
import { PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION } from "../../domain/product/product";
import { isBundleEligible } from "../../domain/rules/publication";
import type { EngineReadyBundleContent } from "../../rules/bundle/engine-ready-bundle";
import { compareStrings } from "../canonicalization/ordering";
import { ruleConfigurationError, type EngineError } from "../errors/engine-error";
import { withinWindow } from "./product-coverage";

/**
 * What stage 3 is allowed to look at.
 *
 * A strict subset of raw facts, plus the two things the earlier stages
 * produced: the coverage state and the legal classification. Deliberately
 * narrow - a product policy that could read the whole fact model would sooner
 * or later be used to make a legal decision by the back door.
 */
export type ProductPolicyFactView = Readonly<{
  /* Raw facts, the same subset the coverage precheck used. */
  desiredProcedure: DesiredProcedure;
  coverageCountry: CountryCode | null;
  /* Stage 1 output. */
  coverageState: ProductCoverageState;
  /* Stage 2 output. */
  caseType: CaseType | null;
}>;

function matches(condition: ProductPolicyCondition, view: ProductPolicyFactView): boolean {
  // An empty list means "any value": a policy states what it narrows, not what
  // it happens to allow.
  if (condition.coverageStates.length > 0 && !condition.coverageStates.includes(view.coverageState)) {
    return false;
  }
  if (
    condition.desiredProcedures.length > 0 &&
    !condition.desiredProcedures.includes(view.desiredProcedure)
  ) {
    return false;
  }
  if (condition.countries.length > 0) {
    if (view.coverageCountry === null || !condition.countries.includes(view.coverageCountry)) {
      return false;
    }
  }
  if (condition.caseTypes.length > 0) {
    if (view.caseType === null || !condition.caseTypes.includes(view.caseType)) {
      return false;
    }
  }
  return true;
}

export type ProductPolicyGateResult = Readonly<{
  effects: readonly AppliedProductPolicyEffect[];
}>;

/**
 * Coverage states that a policy must have something to say about.
 *
 * PARTIAL and RESEARCH_REQUIRED are the two states that mean "the product
 * knows this case is not fully served". Leaving them to a default would let a
 * half-researched country quietly present as a finished answer, so the absence
 * of a policy for them is a configuration error rather than a silent pass.
 */
const STATES_REQUIRING_POLICY: readonly ProductCoverageState[] = ["PARTIAL", "RESEARCH_REQUIRED"];

/**
 * Stage 3: the product policy gate.
 *
 * Runs after legal classification and produces effects only. There is no code
 * path from here to a required procedure, a required document, a formality or
 * a fee, and none that removes a legal statement the rules made: the effect
 * union has no shape for any of those.
 */
export function runProductPolicyGate(
  view: ProductPolicyFactView,
  coverage: ProductCoverageDecision,
  bundle: EngineReadyBundleContent,
): Result<ProductPolicyGateResult, EngineError> {
  const policies = bundle.productPolicyRevisions.filter(
    (policy: ProductPolicyRevision) =>
      isBundleEligible(policy.publicationStatus) &&
      withinWindow(policy.validFrom, policy.validUntil, bundle.effectiveLocalDate),
  );

  for (const policy of policies) {
    if ((policy.payloadSchemaVersion as string) !== (PRODUCT_POLICY_PAYLOAD_SCHEMA_VERSION as string)) {
      return err(
        ruleConfigurationError(
          "PRODUCT_POLICY_MISSING",
          `product policy "${policy.productPolicyId}" uses payload schema ${policy.payloadSchemaVersion}`,
        ),
      );
    }
  }

  const effects: AppliedProductPolicyEffect[] = [];

  /*
   * Scope of the desired procedure comes first.
   *
   * If no live policy is willing to serve the procedure at all, nothing else
   * about the case matters. With no policies in the bundle there is nothing to
   * declare scope, which is itself a configuration error rather than an
   * implicit "everything is supported".
   */
  if (policies.length === 0) {
    return err(
      ruleConfigurationError(
        "PRODUCT_POLICY_MISSING",
        "no product policy is effective, so nothing declares what the product serves",
      ),
    );
  }

  const declaringScope = policies.filter((policy) =>
    policy.payload.supportedDesiredProcedures.includes(view.desiredProcedure),
  );
  if (declaringScope.length === 0) {
    const head = policies[0] as ProductPolicyRevision;
    return ok({
      effects: [
        {
          effect: { kind: "UNSUPPORTED", blocker: "PROCEDURE_OUT_OF_SCOPE" },
          provenance: {
            productPolicyId: head.productPolicyId,
            productPolicyRevisionId: head.productPolicyRevisionId,
            policyRuleKey: "supportedDesiredProcedures",
          },
        },
      ],
    });
  }

  for (const policy of policies) {
    for (const rule of policy.payload.rules as readonly ProductPolicyRule[]) {
      if (!matches(rule.condition, view)) {
        continue;
      }
      effects.push({
        effect: rule.effect,
        provenance: {
          productPolicyId: policy.productPolicyId,
          productPolicyRevisionId: policy.productPolicyRevisionId,
          policyRuleKey: rule.policyRuleKey,
        },
      });
    }
  }

  if (STATES_REQUIRING_POLICY.includes(coverage.state) && effects.length === 0) {
    return err(
      ruleConfigurationError(
        "PRODUCT_POLICY_MISSING",
        `coverage state ${coverage.state} is not governed by any effective product policy`,
      ),
    );
  }

  return ok({
    effects: [...effects].sort((a, b) =>
      compareStrings(
        `${a.provenance.productPolicyRevisionId as string}|${a.provenance.policyRuleKey}`,
        `${b.provenance.productPolicyRevisionId as string}|${b.provenance.policyRuleKey}`,
      ),
    ),
  });
}
