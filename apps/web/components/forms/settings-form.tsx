"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface Settings {
  timezone: string;
  requireApproval: boolean;
  whatsappRequireHumanApproval: boolean;
  aiDefaultProvider: string | null;
  aiDefaultModel: string | null;
  aiImageProvider: string | null;
  aiImageModel: string | null;
  aiRetainPrompts: boolean;
  permissionOverrides: Record<string, string[]>;
}
interface Props {
  organization: { id: string; name: string; slug: string };
  settings: Settings;
  models: { provider: string; model: string; displayName: string; capabilities: string[] }[];
  keys: { provider: string; label: string | null; active: boolean }[];
  configurable: Record<string, string[]>;
}

const NONE = "__none__";

export function SettingsForm({ organization, settings, models, keys, configurable }: Props) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [keyProvider, setKeyProvider] = useState("OPENAI");
  const [apiKey, setApiKey] = useState("");

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

  async function addKey() {
    setBusy(true);
    const res = await fetch("/api/organizations/ai-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: keyProvider, apiKey }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Key rejected");
    toast.success("Key stored (encrypted)");
    setApiKey("");
    router.refresh();
  }

  async function removeKey(provider: string) {
    await fetch("/api/organizations/ai-keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    router.refresh();
  }

  const textModels = models.filter((m) => m.capabilities.includes("text"));
  const imageModels = models.filter((m) => m.capabilities.includes("image"));
  const modelValue = (p: string | null, m: string | null) => (p && m ? `${p}::${m}` : NONE);
  const setModel = (kind: "text" | "image", v: string) => {
    const [p, m] = v === NONE ? [null, null] : v.split("::");
    setS((x) =>
      kind === "text"
        ? { ...x, aiDefaultProvider: p ?? null, aiDefaultModel: m ?? null }
        : { ...x, aiImageProvider: p ?? null, aiImageModel: m ?? null },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            {organization.name} · /{organization.slug}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <Label>Default timezone</Label>
            <Input
              value={s.timezone}
              onChange={(e) => setS({ ...s, timezone: e.target.value })}
              placeholder="Europe/London"
            />
          </div>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Require approval before publishing</span>
              <span className="text-xs text-muted-foreground">Can be overridden per connected account.</span>
            </span>
            <Switch checked={s.requireApproval} onCheckedChange={(v) => setS({ ...s, requireApproval: v })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Human approval for AI WhatsApp replies</span>
              <span className="text-xs text-muted-foreground">Suggestions are never sent automatically when on.</span>
            </span>
            <Switch
              checked={s.whatsappRequireHumanApproval}
              onCheckedChange={(v) => setS({ ...s, whatsappRequireHumanApproval: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Retain AI prompts</span>
              <span className="text-xs text-muted-foreground">Store prompt snapshots with usage records.</span>
            </span>
            <Switch checked={s.aiRetainPrompts} onCheckedChange={(v) => setS({ ...s, aiRetainPrompts: v })} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>AI defaults</CardTitle>
          <CardDescription>
            Used when a member does not pick a model. Platform defaults apply otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <Label>Text model</Label>
            <Select
              value={modelValue(s.aiDefaultProvider, s.aiDefaultModel)}
              onValueChange={(v) => setModel("text", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Platform default / automatic</SelectItem>
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
                <SelectItem value={NONE}>Platform default / automatic</SelectItem>
                {imageModels.map((m) => (
                  <SelectItem key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                    {m.displayName} · {m.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 border-t pt-4">
            <Label>Bring your own keys</Label>
            <div className="flex flex-wrap gap-2">
              {keys.map((k) => (
                <Badge key={k.provider} variant="secondary" className="gap-2">
                  {k.provider} {k.label ? `· ${k.label}` : ""}
                  <button type="button" className="hover:text-destructive" onClick={() => removeKey(k.provider)}>
                    ×
                  </button>
                </Badge>
              ))}
              {keys.length === 0 && <span className="text-xs text-muted-foreground">Using platform keys.</span>}
            </div>
            <div className="flex gap-2">
              <Select value={keyProvider} onValueChange={setKeyProvider}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPENAI">OpenAI</SelectItem>
                  <SelectItem value="ANTHROPIC">Anthropic</SelectItem>
                  <SelectItem value="GOOGLE">Google</SelectItem>
                </SelectContent>
              </Select>
              <Input type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <Button variant="outline" onClick={addKey} disabled={busy || apiKey.length < 10}>
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Keys are validated against the provider, then encrypted at rest. They are never shown again.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Configurable permissions</CardTitle>
          <CardDescription>
            Capabilities the matrix marks as “Configured”. Full and No grants cannot be changed here.
          </CardDescription>
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
                      <Checkbox
                        checked={(s.permissionOverrides[role] ?? []).includes(c)}
                        onCheckedChange={(on) =>
                          setS((x) => {
                            const cur = new Set(x.permissionOverrides[role] ?? []);
                            if (on) cur.add(c);
                            else cur.delete(c);
                            return { ...x, permissionOverrides: { ...x.permissionOverrides, [role]: [...cur] } };
                          })
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
