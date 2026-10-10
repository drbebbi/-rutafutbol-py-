import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getProviderHealth, getSyncRuns, getUnmatchedEvents, importApostaEvent, syncNow, testConnections, manualMapEvent, verifyManualEvent } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, RefreshCw, Upload, Zap, Plug, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import React from "react";

export const Route = createFileRoute("/_authed/admin")({
  ssr: false,
  loader: async () => {
    const [health, runs, unmatched] = await Promise.all([getProviderHealth(), getSyncRuns({ data: { limit: 20 } }), getUnmatchedEvents()]);
    return { health, runs, unmatched };
  },
  head: () => ({ meta: [{ title: "Admin — Aposta Edge AI" }] }),
  component: Admin,
});

function Admin() {
  const { health, runs, unmatched } = Route.useLoaderData();
  const router = useRouter();
  const importFn = useServerFn(importApostaEvent);
  const syncFn = useServerFn(syncNow);
  const testFn = useServerFn(testConnections);
  const mapFn = useServerFn(manualMapEvent);
  const [jsonInput, setJsonInput] = React.useState("");
  const [busy, setBusy] = React.useState(null);

  const doImport = async () => {
    try {
      const payload = JSON.parse(jsonInput);
      setBusy("import");
      const ev = await importFn({ data: payload });
      toast.success(`Imported: ${ev.home_team_name} vs ${ev.away_team_name}`);
      setJsonInput("");
      router.invalidate();
    } catch (e) { toast.error(`Import failed: ${e.message}`); }
    setBusy(null);
  };

  const doSync = async (job) => {
    setBusy(job);
    try {
      await syncFn({ data: { job } });
      toast.success(`Sync complete: ${job}`);
      router.invalidate();
    } catch (e) { toast.error(`Sync failed: ${e.message}`); }
    setBusy(null);
  };

  const verifyFn = useServerFn(verifyManualEvent);
  const [verifyId, setVerifyId] = React.useState("");
  const doVerify = async () => {
    setBusy("verify");
    try { await verifyFn({ data: { event_id: verifyId.trim() } }); toast.success("Marked as verified on aposta.la"); setVerifyId(""); router.invalidate(); }
    catch (e) { toast.error(`Verification failed: ${e.message}`); }
    setBusy(null);
  };

  const doTest = async () => {
    setBusy("test");
    try { const r = await testFn(); toast.success(`Aposta: ${r.aposta.status} · Football: ${r.football.status}`); router.invalidate(); }
    catch (e) { toast.error(e.message); }
    setBusy(null);
  };

  const doMap = async (eventId, externalId) => {
    if (!externalId) { toast.error("Enter external event ID"); return; }
    try { await mapFn({ data: { event_id: eventId, external_event_id: externalId } }); toast.success("Mapped"); router.invalidate(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold flex items-center gap-2"><Shield className="w-6 h-6" />Admin</h1>
        <p className="text-sm text-muted-foreground">Data ingestion, provider status and entity resolution</p>
      </div>

      {/* Provider health */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Provider Health</CardTitle>
          <Button variant="outline" size="sm" onClick={doTest} disabled={busy === "test"}><Plug className="w-4 h-4 mr-1" />Test Connections</Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {health.length === 0 ? <p className="text-xs text-muted-foreground">No health records. Run a health check.</p> : health.map((p) => (
              <div key={p.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="text-sm font-medium capitalize">{p.provider}</p>
                  <p className="text-xs text-muted-foreground">{p.error_message || "OK"}</p>
                </div>
                <Badge variant="outline" className={p.status === "healthy" ? "text-emerald-400 border-emerald-500/30" : p.status === "unconfigured" ? "text-slate-400" : "text-amber-400 border-amber-500/30"}>{p.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sync controls */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4" />Pipeline Sync</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="default" size="sm" onClick={() => doSync("full")} disabled={busy === "full"}><RefreshCw className="w-4 h-4 mr-1" />Run Full Cycle</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("aposta_events")} disabled={busy}>Aposta Events</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("aposta_odds")} disabled={busy}>Aposta Odds</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("match")} disabled={busy}>Match Fixtures</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("football_data")} disabled={busy}>Team Stats</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("predict")} disabled={busy}>Run Predictions</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("value")} disabled={busy}>Value Signals</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("results")} disabled={busy}>Fetch Results</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("settle")} disabled={busy}>Settle</Button>
            <Button variant="outline" size="sm" onClick={() => doSync("metrics")} disabled={busy}>Metrics</Button>
          </div>
        </CardContent>
      </Card>

      {/* Manual import */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />Manual Event Import</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Paste an Aposta event as JSON. Required: <code>aposta_event_id</code>, <code>home_team</code>, <code>away_team</code>. Optional: <code>kickoff_utc</code>, <code>competition</code>, <code>markets</code>.</p>
          <Textarea value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} placeholder={`{\n  "aposta_event_id": "123",\n  "home_team": "Fluminense",\n  "away_team": "Vasco",\n  "kickoff_utc": "2026-10-09T22:00:00Z",\n  "competition": "Brasileirão",\n  "markets": [{\n    "market_key": "1x2",\n    "selections": [\n      {"selection":"home","odds":1.9},\n      {"selection":"draw","odds":3.2},\n      {"selection":"away","odds":4.0}\n    ]\n  }]\n}`} className="font-mono text-xs min-h-[180px]" />
          <Button onClick={doImport} disabled={busy === "import" || !jsonInput.trim()}><Upload className="w-4 h-4 mr-1" />Import (unverified)</Button>
          <p className="text-xs text-muted-foreground">Manual imports are never published until you confirm them against aposta.la. Include <code>source_timestamp</code> (when you read the odds); without it the odds count as stale.</p>
          <div className="flex gap-2">
            <Input value={verifyId} onChange={(e) => setVerifyId(e.target.value)} placeholder="Event ID to verify" className="h-8 text-xs" />
            <Button size="sm" variant="outline" onClick={doVerify} disabled={busy === "verify" || !verifyId.trim()}>Verified on aposta.la</Button>
          </div>
        </CardContent>
      </Card>

      {/* Unmatched events */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertCircle className="w-4 h-4" />Unmatched Events ({unmatched.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {unmatched.length === 0 ? <p className="p-4 text-xs text-muted-foreground">All events matched.</p> : (
            <div className="divide-y divide-border">
              {unmatched.map((ev) => <UnmatchedRow key={ev.id} ev={ev} onMap={doMap} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync runs */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Sync Runs</CardTitle></CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? <p className="p-4 text-xs text-muted-foreground">No sync runs yet.</p> : (
            <div className="divide-y divide-border">
              {runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2 text-xs">
                  <span className="font-medium">{r.job_name}</span>
                  <Badge variant="outline" className={r.status === "success" ? "text-emerald-400" : r.status === "failed" ? "text-red-400" : r.status === "partial" ? "text-amber-400" : r.status === "blocked" ? "text-orange-400" : r.status === "skipped" ? "text-slate-400" : "text-amber-400"}>{r.status}</Badge>
                  <span className="text-muted-foreground">{r.items_processed} ok / {r.items_failed} fail</span>
                  <span className="text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleString("en-US", { timeZone: "UTC" }) : ""}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UnmatchedRow({ ev, onMap }) {
  const [extId, setExtId] = React.useState("");
  return (
    <div className="px-4 py-3 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{ev.home_team_name} vs {ev.away_team_name}</p>
        <p className="text-xs text-muted-foreground">Confidence: {((ev.mapping_confidence || 0) * 100).toFixed(0)}% · {ev.mapping_status}</p>
      </div>
      <Input value={extId} onChange={(e) => setExtId(e.target.value)} placeholder="External ID" className="w-32 h-8 text-xs" />
      <Button size="sm" variant="outline" onClick={() => onMap(ev.id, extId)}>Map</Button>
    </div>
  );
}