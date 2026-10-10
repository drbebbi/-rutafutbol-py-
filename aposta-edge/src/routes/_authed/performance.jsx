import { createFileRoute } from "@tanstack/react-router";
import { getPerformanceMetrics } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authed/performance")({
  ssr: false,
  loader: async () => getPerformanceMetrics(),
  head: () => ({ meta: [{ title: "Performance — Aposta Edge AI" }] }),
  component: Performance,
});

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));

function Performance() {
  const m = Route.useLoaderData();
  const f = m.forecast_1x2 || {};
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Model Performance</h1>
        <p className="text-sm text-muted-foreground">Model {m.model_version} · validation: <span className="capitalize">{m.validation_status}</span></p>
      </div>

      {m.validation_status !== "validated" && (
        <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p>This model has no recorded out-of-sample validation. No recommendations are published; settled signals below are a shadow track record only. Past results do not guarantee future results.</p>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">1X2 forecast quality (settled matches)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Matches" value={f.sample_size ?? 0} />
          <MetricCard label="Log loss" value={num(f.log_loss, 4)} hint="lower is better · uniform guess = 1.0986" />
          <MetricCard label="Brier (3-way)" value={num(f.brier_score, 4)} hint="lower is better · uniform = 0.667" />
          <MetricCard label="Top-pick accuracy" value={pct(f.accuracy)} />
        </CardContent>
      </Card>

      <BettingCard title="Published recommendations" s={m.published} />
      <BettingCard title="Shadow track record (unpublished value signals)" s={m.shadow} />
      <p className="text-xs text-muted-foreground">Flat 1-unit stakes. Yield = net profit ÷ units staked (equals ROI under flat staking). Drawdown = largest peak-to-trough fall of cumulative profit. CLV = taken odds × closing no-vig probability − 1. Pending: {m.pending_recommendations ?? 0}.</p>
    </div>
  );
}

function BettingCard({ title, s = {} }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Bets settled" value={s.bets ?? 0} />
          <MetricCard label="W / L / Push" value={`${s.wins ?? 0} / ${s.losses ?? 0} / ${s.pushes ?? 0}`} />
          <MetricCard label="Profit (units)" value={num(s.profit_units)} accent={s.profit_units > 0 ? "emerald" : s.profit_units < 0 ? "red" : null} />
          <MetricCard label="Yield" value={pct(s.yield)} accent={s.yield > 0 ? "emerald" : s.yield < 0 ? "red" : null} />
          <MetricCard label="Max drawdown (units)" value={num(s.max_drawdown_units)} />
          <MetricCard label="Avg odds" value={num(s.avg_odds)} />
          <MetricCard label="Avg CLV" value={pct(s.avg_clv)} hint={`n = ${s.clv_sample_size ?? 0}`} />
          <MetricCard label="Hit rate" value={pct(s.hit_rate)} />
        </div>
        {!s.bets && <p className="text-xs text-muted-foreground mt-4">No settled bets yet. With small samples these numbers are dominated by variance.</p>}
      </CardContent>
    </Card>
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
