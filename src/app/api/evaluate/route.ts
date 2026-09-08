import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkSameOriginRequest } from "../../../auth/policies/csrf";
import { parseWizardAnswers, summariseDecision, wizardAnswersToFacts } from "../../../application/cases/wizard-mapping";
import { evaluateCaseForUser } from "../../../application/evaluations/evaluate-case-service";
import { createKnowledgeReadAdapter } from "../../../infrastructure/repositories/public-read/knowledge-read-adapter";
import { createBundleStoreAdapter } from "../../../infrastructure/repositories/privileged/bundle-store-adapter";
import { canonicalContentHash } from "../../../infrastructure/hashing/content-hash";
import { createLogger, toClientSafeError } from "../../../infrastructure/logging/logger";
import type { InstantString } from "../../../domain/primitives/instant";
import type { CaseEvaluationRepositoryPort } from "../../../application/ports/ports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger();

/**
 * Anonymous evaluation.
 *
 * State-changing method, cookie-carrying origin, so it performs its own
 * same-origin check. Nothing is persisted: no case row, no tracking identity,
 * and the answers are never logged.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = randomUUID();
  const csrf = checkSameOriginRequest(
    request.method,
    request.headers.get("origin"),
    request.headers.get("host"),
    process.env["NEXT_PUBLIC_SITE_URL"] ?? null,
  );
  if (!csrf.allowed) {
    logger.warn({ event: "evaluate_rejected", correlationId, outcome: csrf.reason, route: "/api/evaluate" });
    return NextResponse.json(
      { ok: false, ...toClientSafeError("FORBIDDEN", correlationId) },
      { status: 403 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const answers = parseWizardAnswers(body);
  if (!answers.ok) {
    return NextResponse.json(
      { ok: false, ...toClientSafeError("BAD_REQUEST", correlationId) },
      { status: 400 },
    );
  }

  const databaseUrl = process.env["SUPABASE_DB_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    logger.error({ event: "evaluate_unconfigured", correlationId, route: "/api/evaluate" });
    return NextResponse.json(
      { ok: false, ...toClientSafeError("UNAVAILABLE", correlationId) },
      { status: 503 },
    );
  }

  // No persistence path is wired for an anonymous evaluation, so the repository
  // port is never called; it is present to satisfy the service contract.
  const evaluations: CaseEvaluationRepositoryPort = {
    record: () =>
      Promise.resolve({
        ok: false,
        error: { kind: "PORT_ERROR", code: "NOT_AUTHORIZED", detail: "anonymous" },
      }),
    listForCase: () => Promise.resolve({ ok: true, value: [] }),
  };

  const outcome = await evaluateCaseForUser(
    wizardAnswersToFacts(answers.value),
    {
      clock: { nowInstant: () => new Date().toISOString().replace(/\.\d{3}Z$/u, "Z") as InstantString },
      hash: { canonicalHash: canonicalContentHash },
      knowledge: createKnowledgeReadAdapter(databaseUrl),
      bundleStore: createBundleStoreAdapter(databaseUrl),
      evaluations,
    },
    null,
  );

  if (!outcome.ok) {
    logger.error({
      event: "evaluate_failed",
      correlationId,
      route: "/api/evaluate",
      errorCode: outcome.error.kind,
    });
    return NextResponse.json(
      { ok: false, ...toClientSafeError("EVALUATION_FAILED", correlationId) },
      { status: 500 },
    );
  }

  const summary = summariseDecision(outcome.value.decision);
  logger.info({
    event: "evaluate_completed",
    correlationId,
    route: "/api/evaluate",
    classificationStatus: summary.status,
    caseType: summary.caseType,
    blockingIssueCount: summary.blockingIssues.length,
    verificationFlagCount: summary.verificationFlags.length,
    bundleContentHash: outcome.value.bundleContentHash,
  });

  return NextResponse.json(
    { ok: true, summary },
    { status: 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
