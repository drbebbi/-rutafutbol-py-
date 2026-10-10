import React from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { captureApostaOdds } from "@/lib/server-fns";
import { buildCapturePayload } from "@/lib/apostaCapture";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const EMPTY = {
  event_url: "", home_team: "", away_team: "", competition: "", kickoff_local: "",
  odds_home: "", odds_draw: "", odds_away: "", odds_over25: "", odds_under25: "", odds_btts_yes: "", odds_btts_no: "",
  confirmed_now: false,
};

// Admin form: read the prices on aposta.la, type them in, submit within a
// minute. The server stamps the observation time; odds count as fresh for 30
// minutes. Event fields are kept after submit so a re-capture is quick.
export function ApostaCaptureForm() {
  const router = useRouter();
  const capture = useServerFn(captureApostaOdds);
  const [f, setF] = React.useState(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const check = buildCapturePayload(f);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await capture({ data: f });
      const status = r.predict?.computation_status === "computed" ? "pronóstico calculado" : `sin pronóstico (${(r.predict?.reasons || []).join(", ") || r.predict?.skipped || "ver evento"})`;
      toast.success(`Cuotas guardadas · ${status}`);
      setF((s) => ({ ...EMPTY, event_url: s.event_url, home_team: s.home_team, away_team: s.away_team, competition: s.competition, kickoff_local: s.kickoff_local }));
      router.invalidate();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const odds = (k, label) => (
    <label className="text-xs space-y-1"><span className="text-muted-foreground">{label}</span>
      <Input inputMode="decimal" value={f[k]} onChange={set(k)} placeholder="—" className="h-9 font-mono" /></label>
  );

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="w-4 h-4" />Capturar cuotas de Aposta.la</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Abre el partido en aposta.la, copia la URL y escribe las cuotas que ves ahora. Hora de Paraguay. Las cuotas valen 30 minutos; después vuelve a capturarlas.</p>
        <Input value={f.event_url} onChange={set("event_url")} placeholder="https://aposta.la/bets#event/123456" className="h-9 text-xs" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input value={f.home_team} onChange={set("home_team")} placeholder="Local (como en Aposta)" className="h-9" />
          <Input value={f.away_team} onChange={set("away_team")} placeholder="Visitante" className="h-9" />
          <Input value={f.competition} onChange={set("competition")} placeholder="Competición" className="h-9" />
          <Input type="datetime-local" value={f.kickoff_local} onChange={set("kickoff_local")} className="h-9" />
        </div>
        <div className="grid grid-cols-3 gap-2">{odds("odds_home", "1 Local")}{odds("odds_draw", "X Empate")}{odds("odds_away", "2 Visitante")}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{odds("odds_over25", "Más 2,5")}{odds("odds_under25", "Menos 2,5")}{odds("odds_btts_yes", "Ambos marcan: Sí")}{odds("odds_btts_no", "Ambos marcan: No")}</div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={f.confirmed_now} onChange={set("confirmed_now")} className="mt-1" />Acabo de leer estas cuotas en aposta.la para este partido.</label>
        {!check.ok && (f.event_url || f.odds_home) ? <ul className="text-xs text-amber-400 list-disc pl-4">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        <Button onClick={submit} disabled={busy || !check.ok}>Guardar cuotas</Button>
      </CardContent>
    </Card>
  );
}
