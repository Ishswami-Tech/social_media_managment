"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AgentAssurance, AgentPublishMode } from "@platform/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AIModelOption, OrganizationSettingsValues } from "./ai-settings";

interface Props {
  organization: { id: string; name: string; slug: string };
  settings: OrganizationSettingsValues;
  models: AIModelOption[];
  configurable: Record<string, string[]>;
}

export function AutomationSettings({ organization, settings, models, configurable }: Props) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/organizations/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Save failed");
    toast.success("Settings saved");
    router.refresh();
  }

  const textModels = models.filter((m) => m.capabilities.includes("text"));

  /** Number inputs stay valid: an empty or bad value falls back to the minimum. */
  const positiveInt = (raw: string, min = 1) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= min ? n : min;
  };
  const togglePermission = (role: string, capability: string, on: boolean) =>
    setS((x) => {
      const current = new Set(x.permissionOverrides[role] ?? []);
      if (on) current.add(capability);
      else current.delete(capability);
      return { ...x, permissionOverrides: { ...x.permissionOverrides, [role]: [...current] } };
    });
  const toggleAllowedModel = (key: string, on: boolean) =>
    setS((x) => ({
      ...x,
      agentAllowedModels: on
        ? [...new Set([...x.agentAllowedModels, key])]
        : x.agentAllowedModels.filter((m) => m !== key),
    }));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            {organization.name} · /{organization.slug}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <Label>Time zone</Label>
            <Input
              value={s.timezone}
              onChange={(e) => setS({ ...s, timezone: e.target.value })}
              placeholder="Europe/London"
            />
          </div>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Review posts before they go out</span>
              <span className="text-xs text-muted-foreground">Can be changed per connected account.</span>
            </span>
            <Switch checked={s.requireApproval} onCheckedChange={(v) => setS({ ...s, requireApproval: v })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Review AI replies on WhatsApp</span>
              <span className="text-xs text-muted-foreground">Replies are never sent on their own when this is on.</span>
            </span>
            <Switch
              checked={s.whatsappRequireHumanApproval}
              onCheckedChange={(v) => setS({ ...s, whatsappRequireHumanApproval: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Keep a copy of AI prompts</span>
              <span className="text-xs text-muted-foreground">Saved alongside the usage record.</span>
            </span>
            <Switch checked={s.aiRetainPrompts} onCheckedChange={(v) => setS({ ...s, aiRetainPrompts: v })} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campaign automation</CardTitle>
          <CardDescription>Limits for posts the AI writes on its own. A campaign can only tighten these.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1">
            <Label>Publishing</Label>
            <Select
              value={s.agentPublishMode}
              onValueChange={(v) => setS({ ...s, agentPublishMode: v as AgentPublishMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Suggest only — you publish</SelectItem>
                <SelectItem value="APPROVAL_REQUIRED">Ask first — someone approves each post</SelectItem>
                <SelectItem value="AUTOMATIC">Publish on its own</SelectItem>
              </SelectContent>
            </Select>
            {s.agentPublishMode === "AUTOMATIC" && (
              <p className="text-xs text-amber-600">
                Posts can go out without review. The person who set up the campaign still needs publishing rights, and
                each account has to allow it.
              </p>
            )}
          </div>
          <div className="grid gap-1">
            <Label>Quality checks</Label>
            <Select value={s.agentAssurance} onValueChange={(v) => setS({ ...s, agentAssurance: v as AgentAssurance })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="JUDGE_ONLY">Standard — faster and cheaper</SelectItem>
                <SelectItem value="HIGH_ASSURANCE">Thorough — adds a second review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>Council width</Label>
            <Select
              value={String(s.agentCouncilSize)}
              onValueChange={(v) => setS({ ...s, agentCouncilSize: Number.parseInt(v, 10) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 — single model per seat</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3 — default</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5 — maximum</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              How many models vote on research, strategy, and judging. Review uses this width only in thorough mode.
            </span>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="agentRunMaxCents">Spend limit per campaign (cents)</Label>
            <Input
              id="agentRunMaxCents"
              type="number"
              min={1}
              max={100000}
              value={s.agentRunMaxCents}
              onChange={(e) => setS({ ...s, agentRunMaxCents: positiveInt(e.target.value) })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="agentMonthlyBudgetCents">Monthly AI budget (cents)</Label>
            <Input
              id="agentMonthlyBudgetCents"
              type="number"
              min={1}
              max={10000000}
              value={s.agentMonthlyBudgetCents}
              onChange={(e) => setS({ ...s, agentMonthlyBudgetCents: positiveInt(e.target.value) })}
            />
            <span className="text-xs text-muted-foreground">Campaigns stop before the budget is used up.</span>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="agentMaxActiveRuns">Campaigns running at the same time</Label>
            <Input
              id="agentMaxActiveRuns"
              type="number"
              min={1}
              max={100}
              value={s.agentMaxActiveRuns}
              onChange={(e) => setS({ ...s, agentMaxActiveRuns: positiveInt(e.target.value) })}
            />
          </div>
          <div className="grid gap-1 md:col-span-2">
            <Label>Models campaigns may use</Label>
            <span className="text-xs text-muted-foreground">Pick none to allow every model you have access to.</span>
            {textModels.length === 0 ? (
              <span className="text-xs text-muted-foreground">No models available yet.</span>
            ) : (
              <div className="mt-1 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {textModels.map((m) => {
                  const key = `${m.provider}::${m.model}`;
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.agentAllowedModels.includes(key)}
                        onChange={(e) => toggleAllowedModel(key, e.target.checked)}
                      />
                      <span className="truncate">
                        {m.displayName} <span className="text-muted-foreground">· {m.provider}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extra permissions</CardTitle>
          <CardDescription>Things each role can do on top of its defaults.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(configurable)
            .filter(([, caps]) => caps.length > 0)
            .map(([role, caps]) => (
              <div key={role} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-semibold">{role}</p>
                <div className="grid gap-2">
                  {caps.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={(s.permissionOverrides[role] ?? []).includes(c)}
                        onChange={(e) => togglePermission(role, c, e.target.checked)}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
