"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AgentAssurance, AgentPublishMode } from "@platform/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The whole organization settings object. Every tab saves all of it. */
export interface OrganizationSettingsValues {
  timezone: string;
  requireApproval: boolean;
  whatsappRequireHumanApproval: boolean;
  aiDefaultProvider: string | null;
  aiDefaultModel: string | null;
  aiImageProvider: string | null;
  aiImageModel: string | null;
  aiRetainPrompts: boolean;
  permissionOverrides: Record<string, string[]>;
  agentPublishMode: AgentPublishMode;
  agentAssurance: AgentAssurance;
  agentRunMaxCents: number;
  agentMonthlyBudgetCents: number;
  agentMaxActiveRuns: number;
  /** Allow-list of "PROVIDER::model" strings; empty = any model the organization can reach. */
  agentAllowedModels: string[];
}

export interface AIModelOption {
  provider: string;
  model: string;
  displayName: string;
  capabilities: string[];
}

export interface AIConnectionRow {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  models: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
}

interface Props {
  settings: OrganizationSettingsValues;
  models: AIModelOption[];
}

const NONE = "__none__";

export function AISettings({ settings, models }: Props) {
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
  const imageModels = models.filter((m) => m.capabilities.includes("image"));
  const modelValue = (p: string | null, m: string | null) => (p && m ? `${p}::${m}` : NONE);
  const setModel = (kind: "text" | "image", v: string) => {
    const [provider, model] = v === NONE ? [null, null] : v.split("::");
    setS((current) =>
      kind === "text"
        ? { ...current, aiDefaultProvider: provider ?? null, aiDefaultModel: model ?? null }
        : { ...current, aiImageProvider: provider ?? null, aiImageModel: model ?? null },
    );
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Default models</CardTitle>
          <CardDescription>Used when someone does not pick a model themselves.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1">
            <Label>Text model</Label>
            <Select value={modelValue(s.aiDefaultProvider, s.aiDefaultModel)} onValueChange={(v) => setModel("text", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose automatically</SelectItem>
                {textModels.map((m) => (
                  <SelectItem key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                    {m.displayName} · {m.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>Image model</Label>
            <Select value={modelValue(s.aiImageProvider, s.aiImageModel)} onValueChange={(v) => setModel("image", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Choose automatically</SelectItem>
                {imageModels.map((m) => (
                  <SelectItem key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                    {m.displayName} · {m.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
