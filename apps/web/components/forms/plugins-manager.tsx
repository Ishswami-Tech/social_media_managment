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
import { Textarea } from "@/components/ui/textarea";

export interface PluginRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: "MCP" | "HTTP";
  url: string;
  method: string;
  inputSchema: unknown;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
}

interface FormState {
  name: string;
  description: string;
  kind: "MCP" | "HTTP";
  url: string;
  headers: string;
  method: "GET" | "POST";
  inputSchema: string;
}

const EMPTY: FormState = { name: "", description: "", kind: "MCP", url: "", headers: "", method: "POST", inputSchema: "" };

/** "Authorization: Bearer x" lines → object; blank lines ignored. */
function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * Settings → Plugins: register MCP servers or HTTP endpoints as tools the model
 * can call while running skills. Secrets are encrypted at rest.
 */
export function PluginsManager({ plugins }: { plugins: PluginRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function request(method: string, body: unknown) {
    setBusy(true);
    const res = await fetch("/api/organizations/plugins", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as { message?: string; plugin?: PluginRow };
    if (!res.ok) {
      toast.error(data.message ?? "Request failed");
      return null;
    }
    router.refresh();
    return data;
  }

  async function save() {
    let inputSchema: Record<string, unknown> | undefined;
    if (form.kind === "HTTP" && form.inputSchema.trim()) {
      try {
        inputSchema = JSON.parse(form.inputSchema) as Record<string, unknown>;
      } catch {
        return toast.error("Argument schema must be valid JSON");
      }
    }
    const headers = parseHeaders(form.headers);
    const body = {
      ...(editingId ? { id: editingId } : {}),
      name: form.name.trim(),
      description: form.description.trim(),
      kind: form.kind,
      url: form.url.trim(),
      method: form.method,
      inputSchema,
      headers: Object.keys(headers).length ? headers : undefined,
    };
    const data = await request(editingId ? "PUT" : "POST", body);
    if (!data) return;
    const status = data.plugin?.lastTestStatus ?? "";
    if (status.startsWith("error")) toast.warning(`Saved, but the test failed: ${status.slice(7)}`);
    else toast.success(`Saved ${form.name} (${status || "ok"})`);
    setForm(EMPTY);
    setEditingId(null);
    setOpen(false);
  }

  function edit(p: PluginRow) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description,
      kind: p.kind,
      url: p.url,
      headers: "",
      method: p.method === "GET" ? "GET" : "POST",
      inputSchema: p.inputSchema ? JSON.stringify(p.inputSchema, null, 2) : "",
    });
    setOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plugins</CardTitle>
        <CardDescription>
          Tools the AI can call while running skills: an MCP server (streamable HTTP) exposes all of its tools; an
          HTTP endpoint becomes one tool that receives the arguments as JSON. Headers are encrypted at rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {plugins.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plugins yet.</p>
        ) : (
          <div className="grid gap-2">
            {plugins.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant="outline">{p.kind}</Badge>
                    {!p.enabled && <Badge variant="secondary">disabled</Badge>}
                    {p.lastTestStatus && (
                      <span className={`text-xs ${p.lastTestStatus.startsWith("ok") ? "text-emerald-600" : "text-destructive"}`}>
                        {p.lastTestStatus}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{p.url}</p>
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(enabled) => request("PATCH", { id: p.id, enabled })}
                    disabled={busy}
                    aria-label={`Enable ${p.name}`}
                  />
                  <Button size="sm" variant="ghost" onClick={() => edit(p)} disabled={busy}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Delete the plugin "${p.name}"?`)) return;
                      if (await request("DELETE", { id: p.id })) toast.success("Plugin deleted");
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            + Add plugin
          </Button>
        ) : (
          <div className="grid gap-3 rounded-md border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company CRM" />
              </div>
              <div className="grid gap-1">
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind: kind as FormState["kind"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MCP">MCP server (streamable HTTP)</SelectItem>
                    <SelectItem value="HTTP">HTTP endpoint (single tool)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>{form.kind === "MCP" ? "Server URL" : "Endpoint URL"}</Label>
              <Input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder={form.kind === "MCP" ? "https://mcp.example.com/mcp" : "https://api.example.com/lookup"}
              />
            </div>
            <div className="grid gap-1">
              <Label>Description (what the tool does; the model reads this)</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Headers (one per line, e.g. Authorization: Bearer …){editingId ? " — leave empty to keep current" : ""}</Label>
              <Textarea rows={2} value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} />
            </div>
            {form.kind === "HTTP" && (
              <div className="grid gap-3 md:grid-cols-[120px_1fr]">
                <div className="grid gap-1">
                  <Label>Method</Label>
                  <Select value={form.method} onValueChange={(method) => setForm({ ...form, method: method as FormState["method"] })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="GET">GET</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label>Argument schema (JSON schema)</Label>
                  <Textarea
                    rows={4}
                    value={form.inputSchema}
                    onChange={(e) => setForm({ ...form, inputSchema: e.target.value })}
                    placeholder='{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}'
                  />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy || !form.name.trim() || !form.url.trim()}>
                {busy ? "Testing & saving…" : editingId ? "Save changes" : "Add plugin"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setEditingId(null);
                  setForm(EMPTY);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
