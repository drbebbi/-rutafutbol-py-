import { createFileRoute } from "@tanstack/react-router";
import { getPerformanceMetrics } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute("/_authed/performance")({
  ssr: false,
  loader: async () => getPerformanceMetrics(),
  head: () => ({ meta: [{ title: "Performance — Aposta Edge AI" }] }),
  component: Performance,
});

function Performance() {
  const m = Route.useLoaderData();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Model Performance</h1>
        <p className="text-sm text-muted-foreground">Calibration & betting metrics — model version {m.model_version}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Sample Size" value={m.sample_size} />
        <MetricCard label="Log Loss" value={m.log_loss?.toFixed(4)} hint="lower is better" />
        <MetricCard label="Brier Score" value={m.brier_score?.toFixed(4)} hint="lower is better" />
        <MetricCard label="Accuracy" value={`${(m.accuracy * 100).toFixed(1)}%`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />Betting Performance</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Bets Settled" value={m.bets} />
            <MetricCard label="Wins / Losses" value={`${m.wins} / ${m.losses}`} />
            <MetricCard label="ROI" value={`${(m.roi * 100).toFixed(1)}%`} accent={m.roi >= 0 ? "emerald" : "red"} />
            <MetricCard label="Yield (units)" value={m.yield?.toFixed(2)} accent={m.yield >= 0 ? "emerald" : "red"} />
          </div>
          {m.bets === 0 && <p className="text-xs text-muted-foreground mt-4">No settled bets yet. Performance metrics populate as events finish and recommendations settle.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, hint, accent }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold font-mono ${accent === "emerald" ? "text-emerald-400" : accent === "red" ? "text-red-400" : ""}`}>{value ?? "—"}</p>
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </CardContent></Card>
  );
}