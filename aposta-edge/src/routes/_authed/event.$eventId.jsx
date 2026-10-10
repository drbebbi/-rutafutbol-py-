import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getEventDetail } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill, EvCell, OddsDisplay, ConfidencePill, ProbBar, QualityBadge, EmptyState } from "@/components/betting/UiBits";
import { formatPercent } from "@/lib/oddsMath";
import { ArrowLeft, TrendingUp, Activity, ShieldAlert, AlertTriangle, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authed/event/$eventId")({
  ssr: false,
  loader: async ({ params }) => {
    const detail = await getEventDetail({ data: { id: params.eventId } });
    if (!detail) throw notFound();
    return detail;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.event?.home_team_name} vs ${loaderData?.event?.away_team_name}` }] }),
  component: EventDetail,
});

function EventDetail() {
  const d = Route.useLoaderData();
  const { event, markets, selections, predictions, injuries, lineups, snapshots, signals, provenance, odds_fresh, kickoff_passed, mapping_confident, is_demo, verifiable, prediction_computed, model_version } = d;
  const prediction = predictions[0];
  const kickoff = event.kickoff_utc ? new Date(event.kickoff_utc).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : "TBD";
  const oddsObserved = snapshots[0]?.source_timestamp ? new Date(snapshots[0].source_timestamp).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : null;
  const oddsImported = snapshots[0]?.retrieval_timestamp ? new Date(snapshots[0].retrieval_timestamp).toLocaleString("en-US", { timeZone: "America/Asuncion" }) : null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/"><ArrowLeft className="w-4 h-4 mr-1" />Back</Link></Button>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-heading font-bold">{event.home_team_name} <span className="text-muted-foreground">vs</span> {event.away_team_name}</h1>
          <p className="text-sm text-muted-foreground">{event.competition_name || "—"} · {kickoff} (America/Asuncion) · <span className="capitalize">{event.status}</span></p>
          {event.aposta_event_id && <p className="text-xs text-muted-foreground font-mono">Aposta ID: {event.aposta_event_id}{event.aposta_event_url ? <a href={event.aposta_event_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center text-chart-1 hover:underline">Source <ExternalLink className="w-3 h-3 ml-0.5" /></a> : null}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={is_demo ? "text-red-400 border-red-500/40 bg-red-500/10" : verifiable ? "text-emerald-400 border-emerald-500/30" : "text-amber-400 border-amber-500/30"}>{provenance.label}</Badge>
          {event.is_locked && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Locked (kickoff passed)</Badge>}
          {kickoff_passed && !event.is_locked && <Badge variant="outline" className="text-amber-400 border-amber-500/30">Kickoff passed</Badge>}
          {event.mapping_status !== "matched" && <Badge variant="outline" className="text-orange-400 border-orange-500/30 capitalize">Mapping: {event.mapping_status}</Badge>}
          {!mapping_confident && event.mapping_status === "matched" && <Badge variant="outline" className="text-orange-400 border-orange-500/30">Mapping unconfirmed</Badge>}
        </div>
      </div>

      {/* Provenance / data-availability banner */}
      {!verifiable && (
        <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-400">{is_demo ? "DEMO DATA — not a real Aposta event" : "Aposta data unavailable"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{is_demo ? "This record is test data and is excluded from active recommendations and performance metrics." : "No verifiable Aposta source for this event. Recommendations are suppressed until provenance is confirmed."}</p>
          </div>
        </div>
      )}

      {/* Odds provenance detail */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-muted-foreground">Import method</p><p className="font-medium capitalize">{provenance.source.replace(/_/g, " ")}</p></div>
        <div><p className="text-xs text-muted-foreground">Odds observed</p><p className="font-medium">{oddsObserved || "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Odds imported</p><p className="font-medium">{oddsImported || "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Odds freshness</p><p className={`font-medium ${odds_fresh ? "text-emerald-400" : "text-amber-400"}`}>{odds_fresh ? "Fresh (<30 min)" : event.last_odds_sync_at ? "Stale" : "Missing"}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Prediction */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Model Prediction</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {prediction && prediction.computation_status !== "computed" ? (
              <div className="text-sm space-y-1">
                <p className="font-medium text-amber-400">No forecast — insufficient data</p>
                <p className="text-xs text-muted-foreground">The model needs at least 6 verified pre-kickoff results per team. Reasons: {(prediction.insufficient_reasons || []).join(", ") || "not recorded"}</p>
              </div>
            ) : prediction ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">1X2 Probability</p>
                  <ProbBar home={prediction.probabilities?.home} draw={prediction.probabilities?.draw} away={prediction.probabilities?.away} />
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><p className="text-xs text-muted-foreground">Exp. Goals Home</p><p className="text-lg font-bold font-mono">{prediction.expected_goals_home?.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Exp. Goals Away</p><p className="text-lg font-bold font-mono">{prediction.expected_goals_away?.toFixed(2)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Version</p><p className="text-lg font-bold font-mono">v{prediction.version}</p></div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Confidence:</span>
                  <ConfidencePill confidence={prediction.confidence} />
                  <span className="text-muted-foreground">Model {model_version?.label || "—"} · {model_version?.validation_status || "unvalidated"} · {prediction.calibration_status || "uncalibrated"}</span>
                </div>
              </>
            ) : (
              <EmptyState icon={Activity} title="No prediction yet" hint="Run the prediction pipeline from Admin to generate a model forecast." />
            )}
          </CardContent>
        </Card>

        {/* Data quality */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4" />Data Quality</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {prediction?.data_quality ? (
              Object.entries(prediction.data_quality).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</span><QualityBadge quality={v} /></div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No data quality snapshot available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Value signals */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Value Signals</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!verifiable || !prediction_computed ? (
            <div className="px-4 py-3 text-xs text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {is_demo ? "Signals suppressed — demo data." : !verifiable ? "Signals suppressed — unverified data source." : "Signals suppressed — prediction not computed from verifiable inputs."}
            </div>
          ) : signals.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No active value signals" />
          ) : (
            <div className="divide-y divide-border">
              {signals.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium capitalize">{s.market_key.replace(/_/g, " ")} · {s.selection}{s.line != null ? ` ${s.line}` : ""}</p>
                    <p className="text-xs text-muted-foreground">Model: {formatPercent(s.model_probability)}{s.probability_interval ? ` (±1 SE ${formatPercent(s.probability_interval[0])}–${formatPercent(s.probability_interval[1])})` : ""} · No-vig: {formatPercent(s.aposta_no_vig_probability)}</p>
                    <p className={`text-xs ${s.published ? "text-emerald-400" : "text-muted-foreground"}`}>{s.published ? "Published recommendation" : `Not recommended: ${(s.gate_reasons || []).join(", ").replace(/_/g, " ")}`}</p>
                  </div>
                  <div className="text-right"><OddsDisplay odds={s.aposta_odds} /><EvCell ev={s.expected_value} /></div>
                  <StatusPill status={s.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Markets & odds */}
      <Card>
        <CardHeader><CardTitle className="text-base">Markets & Live Odds</CardTitle></CardHeader>
        <CardContent className="p-0">
          {markets.length === 0 ? <EmptyState title="No markets loaded" /> : (
            <div className="divide-y divide-border">
              {markets.map((m) => {
                const sels = selections.filter((s) => s.market_id === m.id);
                return (
                  <div key={m.id} className="px-4 py-3">
                    <p className="text-sm font-medium capitalize mb-2">{m.market_name || m.market_key.replace(/_/g, " ")}{m.line != null ? ` (${m.line})` : ""}</p>
                    <div className="flex flex-wrap gap-2">
                      {sels.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 bg-muted/50 rounded px-2 py-1">
                          <span className="text-xs capitalize">{s.selection}</span>
                          <OddsDisplay odds={s.current_odds} />
                          {s.opening_odds && s.current_odds < s.opening_odds && <span className="text-xs text-emerald-400">▼</span>}
                          {s.opening_odds && s.current_odds > s.opening_odds && <span className="text-xs text-red-400">▲</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Injuries & lineups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Lineups</CardTitle></CardHeader>
          <CardContent>
            {lineups.length === 0 ? <p className="text-xs text-muted-foreground">No lineup data.</p> : (
              <div className="space-y-2">
                {lineups.map((l) => (
                  <div key={l.id} className="text-sm">
                    <p className="font-medium">{l.is_home ? event.home_team_name : event.away_team_name} <span className="text-xs text-muted-foreground">({l.formation || "—"})</span></p>
                    <p className="text-xs text-muted-foreground capitalize">{l.status}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Injuries & Suspensions</CardTitle></CardHeader>
          <CardContent>
            {injuries.length === 0 ? <p className="text-xs text-muted-foreground">No injury data.</p> : (
              <div className="space-y-1">
                {injuries.map((i, idx) => (
                  <div key={idx} className="text-sm flex justify-between"><span>{i.player_name}</span><Badge variant="outline" className="text-xs capitalize">{i.status}</Badge></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Odds history */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Odds History (immutable snapshots)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {snapshots.slice(0, 50).map((s) => (
                <div key={s.id} className="flex justify-between px-4 py-2 text-xs">
                  <span className="capitalize">{s.market_key} · {s.selection}{s.line != null ? ` ${s.line}` : ""}</span>
                  <span className="font-mono">{s.decimal_odds.toFixed(2)}</span>
                  <span className="text-muted-foreground">{new Date(s.retrieval_timestamp).toLocaleTimeString("en-US", { timeZone: "UTC" })}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}