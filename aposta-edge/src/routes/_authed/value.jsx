import { createFileRoute } from "@tanstack/react-router";
import { listRecommendations } from "@/lib/server-fns";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill, EvCell, OddsDisplay, ConfidencePill, EmptyState } from "@/components/betting/UiBits";
import { TrendingUp } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/value")({
  ssr: false,
  loader: async () => listRecommendations({ data: { limit: 50 } }),
  head: () => ({ meta: [{ title: "Value Signals — Aposta Edge AI" }] }),
  component: ValueSignals,
});

function ValueSignals() {
  const signals = Route.useLoaderData();
  const sorted = [...signals].sort((a, b) => (b.quality_adjusted_ev ?? 0) - (a.quality_adjusted_ev ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">Value Signals</h1>
        <p className="text-sm text-muted-foreground">Ranking by quality-adjusted expected value — edge weighted by data confidence</p>
      </div>

      {sorted.length === 0 ? (
        <Card><CardContent className="py-12">
          <EmptyState icon={TrendingUp} title="No value signals found" hint="Import events and run the pipeline from Admin to generate predictions and value analysis." />
        </CardContent></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Event</th>
                  <th className="text-left px-4 py-2 font-medium">Market</th>
                  <th className="text-left px-4 py-2 font-medium">Selection</th>
                  <th className="text-right px-4 py-2 font-medium">Aposta Odds</th>
                  <th className="text-right px-4 py-2 font-medium">Model Prob</th>
                  <th className="text-right px-4 py-2 font-medium">Edge</th>
                  <th className="text-right px-4 py-2 font-medium">EV</th>
                  <th className="text-center px-4 py-2 font-medium">Conf</th>
                  <th className="text-center px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Link to="/event/$eventId" params={{ eventId: s.event_id }} className="font-medium hover:text-chart-1">
                        {s.event?.home_team_name} vs {s.event?.away_team_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{s.event?.competition_name || "—"}</p>
                    </td>
                    <td className="px-4 py-2 capitalize text-xs">{s.market_key.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2 capitalize">{s.selection}{s.line != null ? ` ${s.line}` : ""}</td>
                    <td className="px-4 py-2 text-right"><OddsDisplay odds={s.aposta_odds} /></td>
                    <td className="px-4 py-2 text-right font-mono">{(s.model_probability * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right font-mono">{(s.probability_edge * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right"><EvCell ev={s.expected_value} /></td>
                    <td className="px-4 py-2 text-center"><ConfidencePill confidence={s.confidence} /></td>
                    <td className="px-4 py-2 text-center"><StatusPill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}