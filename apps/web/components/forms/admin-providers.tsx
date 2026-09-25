"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface ProviderConnection {
  id: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  models: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  keyHint: string;
}

/** The four things an admin can add. The gateway is stored as OPENAI because that is the wire format it speaks. */
const PROVIDER_TYPES = [
  { value: "OPENAI", label: "OpenAI", placeholder: "https://api.openai.com/v1", baseUrlRequired: false },
  { value: "ANTHROPIC", label: "Anthropic", placeholder: "https://api.anthropic.com", baseUrlRequired: false },
  {
    value: "GOOGLE",
    label: "Google",
    placeholder: "https://generativelanguage.googleapis.com",
    baseUrlRequired: false,
  },
  {
    value: "META",
    label: "Meta AI (Muse Spark)",
    placeholder: "https://api.meta.ai/v1",
    baseUrlRequired: false,
  },
  {
    value: "HUGGINGFACE",
    label: "Hugging Face (images, free tier)",
    placeholder: "https://router.huggingface.co/hf-inference",
    baseUrlRequired: false,
  },
  {
    value: "POLLINATIONS",
    label: "Pollinations (images, free; token optional)",
    placeholder: "https://image.pollinations.ai",
    baseUrlRequired: false,
  },
  {
    value: "GATEWAY",
    label: "OpenAI-compatible gateway",
    placeholder: "https://your-gateway.example.com/v1",
    baseUrlRequired: true,
  },
] as const;

type ProviderType = (typeof PROVIDER_TYPES)[number]["value"];

function typeFor(connection: ProviderConnection): ProviderType {
  const stored = connection.provider.toUpperCase();
  if (stored === "ANTHROPIC" || stored === "GOOGLE" || stored === "META" || stored === "HUGGINGFACE" || stored === "POLLINATIONS") return stored;
  return connection.baseUrl ? "GATEWAY" : "OPENAI";
}

function labelFor(type: ProviderType): string {
  return PROVIDER_TYPES.find((t) => t.value === type)?.label ?? type;
}

interface FormState {
  id?: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  models: string;
}

const EMPTY_FORM: FormState = { name: "", type: "OPENAI", baseUrl: "", apiKey: "", models: "" };

function statusBadge(status: string | null) {
  if (!status) return <Badge variant="outline">Not tested yet</Badge>;
  if (status === "ok") return <Badge variant="success">Working</Badge>;
  return <Badge variant="destructive">{status.replace(/^error:\s*/, "")}</Badge>;
}

export function ProviderConnections({
  connections,
  envProviders,
}: {
  connections: ProviderConnection[];
  envProviders: Record<string, boolean>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedType = PROVIDER_TYPES.find((t) => t.value === form?.type) ?? PROVIDER_TYPES[0];
  const envRows = Object.entries(envProviders).filter(([, present]) => present);
  // A provider added here replaces the server's key for that type, so say so on the row.
  const covered = new Set<string>(
    connections.filter((c) => c.enabled).map((c) => (typeFor(c) === "GATEWAY" ? "OPENAI" : typeFor(c))),
  );

  async function send(method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ai-providers", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        message?: string;
        test?: { ok: boolean; message: string };
      };
      if (!res.ok) {
        toast.error(data.message ?? "Something went wrong. Please try again.");
        return false;
      }
      if (data.test) {
        if (data.test.ok) toast.success(`Connected. ${data.test.message}.`);
        else toast.error(`Saved, but the test failed: ${data.test.message}`);
      } else {
        toast.success("Saved");
      }
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    const baseUrl = form.baseUrl.trim();
    if (selectedType.baseUrlRequired && !baseUrl) {
      toast.error("A gateway needs a base URL.");
      return;
    }
    const models = form.models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const payload = {
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(),
      provider: form.type === "GATEWAY" ? "OPENAI" : form.type,
      ...(baseUrl ? { baseUrl } : {}),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(models.length ? { models } : {}),
    };
    if (!form.id && !form.apiKey.trim()) {
      toast.error("An API key is required.");
      return;
    }
    if (await send(form.id ? "PUT" : "POST", payload)) setForm(null);
  }

  async function test(connection: ProviderConnection) {
    await send("PUT", {
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
      ...(connection.models ? { models: JSON.parse(connection.models) as string[] } : {}),
    });
  }

  function edit(connection: ProviderConnection) {
    setForm({
      id: connection.id,
      name: connection.name,
      type: typeFor(connection),
      baseUrl: connection.baseUrl ?? "",
      apiKey: "",
      models: connection.models ? (JSON.parse(connection.models) as string[]).join(", ") : "",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Providers</CardTitle>
        <CardDescription>
          Add the AI services this platform can use. Keys are encrypted and only the last four characters are ever shown
          again.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {connections.length === 0 && envRows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No providers yet. Add one to start discovering models.
          </p>
        ) : null}

        {connections.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <div className="min-w-48 flex-1">
              <span className="block text-sm font-medium">{c.name}</span>
              <span className="block text-xs text-muted-foreground">
                {c.baseUrl ?? "Default endpoint"} · key ending {c.keyHint}
              </span>
            </div>
            <Badge variant="secondary">{labelFor(typeFor(c))}</Badge>
            {statusBadge(c.lastTestStatus)}
            <Switch
              checked={c.enabled}
              disabled={busy}
              aria-label={`Enable ${c.name}`}
              onCheckedChange={(enabled) => send("PATCH", { id: c.id, enabled })}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => test(c)}>
              Test
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => edit(c)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => send("DELETE", { id: c.id })}>
              Delete
            </Button>
          </div>
        ))}

        {envRows.map(([provider]) => (
          <div key={provider} className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3">
            <div className="min-w-48 flex-1">
              <span className="block text-sm font-medium">{labelFor(provider as ProviderType)}</span>
              <span className="block text-xs text-muted-foreground">
                {covered.has(provider)
                  ? "Key set on the server, but a provider above is used instead."
                  : "Key set on the server. Add a provider above to take over from it."}
              </span>
            </div>
            <Badge variant="outline">From environment</Badge>
          </div>
        ))}

        {form ? (
          <div className="grid gap-3 rounded-md border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="provider-name">Name</Label>
                <Input
                  id="provider-name"
                  placeholder="OpenAI production"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="provider-type">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as ProviderType })}>
                  <SelectTrigger id="provider-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="provider-url">
                  Base URL {selectedType.baseUrlRequired ? "" : <span className="text-muted-foreground">(optional)</span>}
                </Label>
                <Input
                  id="provider-url"
                  placeholder={selectedType.placeholder}
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="provider-key">API key</Label>
                <Input
                  id="provider-key"
                  type="password"
                  autoComplete="off"
                  placeholder={form.id ? "Leave blank to keep the current key" : "Paste the key"}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="provider-models">
                  Models <span className="text-muted-foreground">(optional, comma separated)</span>
                </Label>
                <Input
                  id="provider-models"
                  placeholder="Leave blank to use everything this provider offers"
                  value={form.models}
                  onChange={(e) => setForm({ ...form, models: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button disabled={busy || !form.name.trim()} onClick={save}>
                {busy ? "Testing…" : form.id ? "Save changes" : "Add provider"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setForm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="outline" onClick={() => setForm({ ...EMPTY_FORM })}>
              + Add provider
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
