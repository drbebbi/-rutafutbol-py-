import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { listEvents, listRecommendations } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Calendar, ArrowRight, Activity } from "lucide-react";
import { StatusPill, EvCell, OddsDisplay, EmptyState } from "@/components/betting/UiBits";
import { formatPercent } from "@/lib/oddsMath";

export const Route = createFileRoute("/_authed/")({
  ssr: false,
  loader: async () => {
    const [events, recs] = await Promise.all([listEvents({ data: { limit: 20 } }), listRecommendations({ data: { limit: 8 } })]);
    return { events, recs };
  },
  head: () => ({ meta: [{ title: "Dashboard — Aposta Edge AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { events, recs } = Route.useLoaderData();
  const router = useRouter();
  const valueCount = recs.filter((r) => ["value", "strong_value"].includes(r.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Quantitative value analysis for football markets</p>
        </div>
        <Button asChild><Link to="/value"><TrendingUp className="w-4 h-4 mr-2" />Value Signals</Link></Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Upcoming Events" value={events.length} icon={Calendar} />
        <StatCard label="Active Value Signals" value={valueCount} icon={TrendingUp} accent="emerald" />
        <StatCard label="Watchlist Signals" value={recs.length} icon={Activity} />
        <StatCard label="Strong Value" value={recs.filter((r) => r.status === "strong_value").length} icon={TrendingUp} accent="emerald" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Top Value Signals</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/value">View all <ArrowRight className="w-3 h-3 ml-1" /></Link></Button>
        </CardHeader>
        <CardContent className="p-0">
          {recs.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No active value signals" hint="Run a sync or import events from the Admin panel to generate predictions and value signals." />
          ) : (
            <div className="divide-y divide-border">
              {recs.slice(0, 6).map((r) => (
                <Link key={r.id} to="/event/$eventId" params={{ eventId: r.event_id }} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.event?.home_team_name} vs {r.event?.away_team_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{r.market_key.replace(/_/g, " ")} · {r.selection}{r.line != null ? ` ${r.line}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <OddsDisplay odds={r.aposta_odds} />
                    <EvCell ev={r.expected_value} />
                  </div>
                  <StatusPill status={r.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Upcoming Events</CardTitle></CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <EmptyState icon={Calendar} title="No events loaded" hint="Import events from the Admin panel to start analysis." />
          ) : (
            <div className="divide-y divide-border">
              {events.slice(0, 8).map((ev) => (
                <Link key={ev.id} to="/event/$eventId" params={{ eventId: ev.id }} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{ev.home_team_name} vs {ev.away_team_name}</p>
                    <p className="text-xs text-muted-foreground">{ev.competition_name || "—"} · {ev.kickoff_utc ? new Date(ev.kickoff_utc).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : "TBD"}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${accent === "emerald" ? "text-emerald-400" : ""}`}>{value}</p>
          </div>
          <Icon className="w-5 h-5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
}