import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/oddsMath";

const STATUS_STYLES = {
  strong_value: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  value: "bg-green-500/15 text-green-400 border-green-500/30",
  watch: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  no_value: "bg-muted text-muted-foreground border-border",
  avoid: "bg-red-500/15 text-red-400 border-red-500/30",
  insufficient_data: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  stale: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  market_suspended: "bg-red-500/15 text-red-400 border-red-500/30",
};

export function StatusPill({ status, className }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border capitalize", STATUS_STYLES[status] || STATUS_STYLES.no_value, className)}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}

export function ConfidencePill({ confidence }) {
  const styles = { high: "bg-emerald-500/15 text-emerald-400", medium: "bg-amber-500/15 text-amber-400", low: "bg-red-500/15 text-red-400" };
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize", styles[confidence] || styles.medium)}>{confidence}</span>;
}

export function EvCell({ ev }) {
  const v = Number(ev);
  const positive = Number.isFinite(v) && v >= 0;
  return (
    <span className={cn("font-mono text-sm font-semibold", positive ? "text-emerald-400" : "text-red-400")}>
      {formatSignedPercent(v)}
    </span>
  );
}

export function OddsDisplay({ odds }) {
  return <span className="font-mono">{formatOdds(odds)}</span>;
}

export function ProbBar({ home, draw, away }) {
  const total = (home || 0) + (draw || 0) + (away || 0) || 1;
  const h = ((home || 0) / total) * 100;
  const d = ((draw || 0) / total) * 100;
  const a = ((away || 0) / total) * 100;
  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        <div className="bg-chart-1" style={{ width: `${h}%` }} />
        <div className="bg-muted-foreground/50" style={{ width: `${d}%` }} />
        <div className="bg-chart-2" style={{ width: `${a}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>1: {formatPercent(home)}</span>
        <span>X: {formatPercent(draw)}</span>
        <span>2: {formatPercent(away)}</span>
      </div>
    </div>
  );
}

export function QualityBadge({ quality }) {
  const styles = { full: "text-emerald-400", partial: "text-amber-400", missing: "text-red-400", good: "text-emerald-400", acceptable: "text-amber-400", poor: "text-red-400", fresh: "text-emerald-400", stale: "text-amber-400", confirmed: "text-emerald-400", expected: "text-amber-400", not_confirmed: "text-red-400", sufficient: "text-emerald-400", limited: "text-amber-400", insufficient: "text-red-400" };
  return <span className={cn("text-xs capitalize", styles[quality] || "text-muted-foreground")}>{quality?.replace(/_/g, " ") || "—"}</span>;
}

export function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && <Icon className="w-10 h-10 text-muted-foreground/40 mb-3" />}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{hint}</p>}
    </div>
  );
}