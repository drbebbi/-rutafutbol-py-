import { createFileRoute } from "@tanstack/react-router";

// POST /api/cron/cycle — entry point for an external scheduler (Base44
// automation, cron service, GitHub Actions). Authenticated with the
// CRON_SECRET app secret in the `Authorization: Bearer <secret>` header; when
// the secret is not configured the endpoint is disabled. The cycle runs in the
// background (waitUntil) under a pipeline lease, so overlapping calls are
// skipped instead of running twice.
const encoder = new TextEncoder();
function safeEqual(a, b) {
  const x = encoder.encode(String(a)), y = encoder.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const Route = createFileRoute("/api/cron/cycle")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const { secrets, waitUntil } = await import("base44:runtime");
        const expected = secrets.get("CRON_SECRET");
        if (!expected) return Response.json({ error: "CRON_SECRET not configured" }, { status: 503 });
        const header = request.headers.get("authorization") || "";
        if (!safeEqual(header, `Bearer ${expected}`)) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { runScheduledCycle } = await import("@/lib/server/syncPipeline.server.js");
        const b = context.getBase44().asServiceRole;
        waitUntil(runScheduledCycle(b, "scheduled").catch(() => {}));
        return Response.json({ accepted: true }, { status: 202, headers: { "cache-control": "no-store" } });
      },
    },
  },
});
