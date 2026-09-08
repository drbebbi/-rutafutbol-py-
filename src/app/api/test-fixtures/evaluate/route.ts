import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkSameOriginRequest } from "../../../../auth/policies/csrf";
import {
  parseWizardAnswers,
  summariseDecision,
  wizardAnswersToFacts,
} from "../../../../application/cases/wizard-mapping";
import { JURISDICTION_TIME_ZONE } from "../../../../domain/primitives/time-zone";
import { CURRENT_ENGINE_DESCRIPTOR } from "../../../../domain/evaluation/engine-descriptor";
import { createEvaluationExecutionContext } from "../../../../case-engine/date-math/execution-context";
import { evaluateCase } from "../../../../case-engine/evaluate/evaluate-case";
import { prepareEngineReadyBundle } from "../../../../rules/bundle/engine-ready-bundle";
import { syntheticKnowledgeBundle } from "./synthetic-knowledge";
import type { InstantString } from "../../../../domain/primitives/instant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CONTROLLED SYNTHETIC TEST FIXTURE ROUTE.
 *
 * Exists so the system wiring can be exercised end to end before an approved
 * knowledge base exists. It serves entirely synthetic rules that assert nothing
 * about Paraguayan law, and it refuses to run unless explicitly enabled and
 * outside production.
 */
function isEnabled(): boolean {
  const environment = process.env["CEDULA_ENVIRONMENT"] ?? "LOCAL";
  return process.env["CEDULA_SYNTHETIC_KNOWLEDGE"] === "1" && environment !== "PRODUCTION";
}

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();

  if (!isEnabled()) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Not found", correlationId }, { status: 404 });
  }

  const csrf = checkSameOriginRequest(
    request.method,
    request.headers.get("origin"),
    request.headers.get("host"),
    null,
  );
  if (!csrf.allowed) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "Forbidden", correlationId },
      { status: 403 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const answers = parseWizardAnswers(body);
  if (!answers.ok) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "Malformed request", correlationId },
      { status: 400 },
    );
  }

  const context = createEvaluationExecutionContext({
    evaluatedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z") as InstantString,
    jurisdictionTimeZone: JURISDICTION_TIME_ZONE,
  });
  if (!context.ok) {
    return NextResponse.json(
      { ok: false, code: "EVALUATION_FAILED", message: "Evaluation failed", correlationId },
      { status: 500 },
    );
  }

  const bundle = prepareEngineReadyBundle(
    syntheticKnowledgeBundle(),
    context.value.effectiveLocalDate,
    CURRENT_ENGINE_DESCRIPTOR,
  );
  if (!bundle.ok) {
    return NextResponse.json(
      { ok: false, code: "EVALUATION_FAILED", message: "Evaluation failed", correlationId },
      { status: 500 },
    );
  }

  const decision = evaluateCase(
    wizardAnswersToFacts(answers.value),
    context.value,
    bundle.value,
    CURRENT_ENGINE_DESCRIPTOR,
  );
  if (!decision.ok) {
    return NextResponse.json(
      { ok: false, code: "EVALUATION_FAILED", message: "Evaluation failed", correlationId },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, summary: summariseDecision(decision.value) },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
