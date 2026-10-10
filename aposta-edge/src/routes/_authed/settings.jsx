import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getUserSettings, updateUserSettings } from "@/lib/server-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import React from "react";

export const Route = createFileRoute("/_authed/settings")({
  ssr: false,
  loader: async () => getUserSettings(),
  head: () => ({ meta: [{ title: "Settings — Aposta Edge AI" }] }),
  component: Settings,
});

function Settings() {
  const settings = Route.useLoaderData();
  const update = useServerFn(updateUserSettings);
  const router = useRouter();
  const [form, setForm] = React.useState(settings);
  const [saving, setSaving] = React.useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await update({ data: { id: form.id, timezone: form.timezone, value_profile: form.value_profile, min_ev: Number(form.min_ev), min_mapping_confidence: form.min_mapping_confidence, odds_format: form.odds_format } });
      toast.success("Settings saved");
      router.invalidate();
    } catch (err) { toast.error("Failed to save settings"); }
    setSaving(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Customize your value profile and display preferences</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Preferences</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Input value={form.timezone || ""} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Odds Format</Label>
                <Select value={form.odds_format || "decimal"} onValueChange={(v) => setForm({ ...form, odds_format: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="decimal">Decimal</SelectItem>
                    <SelectItem value="american">American</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value Profile</Label>
                <Select value={form.value_profile || "balanced"} onValueChange={(v) => setForm({ ...form, value_profile: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Min EV Threshold (%)</Label>
                <Input type="number" step="0.5" value={form.min_ev ?? 3} onChange={(e) => setForm({ ...form, min_ev: e.target.value })} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Min Mapping Confidence</Label>
                <Select value={form.min_mapping_confidence || "high"} onValueChange={(v) => setForm({ ...form, min_mapping_confidence: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Settings"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}