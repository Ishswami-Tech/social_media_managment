"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AgentAssurance, AgentPublishMode } from "@platform/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  /** Agent Council (campaign automation) */
  agentPublishMode: AgentPublishMode;
  agentAssurance: AgentAssurance;
  agentRunMaxCents: number;
  agentMonthlyBudgetCents: number;
  agentMaxActiveRuns: number;
  /** Allow-list of "PROVIDER::model" strings; empty = any model the organization can reach. */
  agentAllowedModels: string[];
}
interface Props {
  organization: { id: string; name: string; slug: string };
  settings: Settings;
  models: { provider: string; model: string; displayName: string; capabilities: string[] }[];
  keys: { provider: string; label: string | null; active: boolean }[];
  connections?: {
    id: string;
    name: string;
    provider: string;
    baseUrl: string;
    models: string | null;
    isActive: boolean;
    lastTestedAt: string | null;
    lastTestStatus: string | null;
  }[];
  configurable: Record<string, string[]>;
}

const NONE = "__none__";
const PROVIDERS_LIST = ["OpenAI", "Anthropic", "Google", "Groq", "Cohere", "Mistral", "Together AI", "", "Ollama", "Custom"];

export function SettingsForm({ organization, settings, models, keys, connections = [], configurable }: Props) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);

  // BYO key form
  const [keyProvider, setKeyProvider] = useState("OPENAI");
  const [apiKey, setApiKey] = useState("");

  // Connection form
  const [showConnForm, setShowConnForm] = useState(false);
  const [connName, setConnName] = useState("");
  const [connProvider, setConnProvider] = useState("CUSTOM");
  const [connUrl, setConnUrl] = useState("");
  const [connKey, setConnKey] = useState("");
  const [connModels, setConnModels] = useState("");

  // Connection edit form
  const [editingConn, setEditingConn] = useState<{ id: string; name: string; provider: string; baseUrl: string; models: string | null; apiKey: string } | null>(null);

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

  async function addConnection() {
    if (!connName.trim() || !connUrl.trim() || !connKey.trim()) {
      return toast.error("Name, URL and API key are required");
    }
    setBusy(true);
    const modelIds = connModels.split(",").map((m) => m.trim()).filter(Boolean);
    const res = await fetch("/api/organizations/ai-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: connName.trim(),
        provider: connProvider,
        baseUrl: connUrl.trim(),
        apiKey: connKey.trim(),
        modelIds,
      }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.error ?? data.message ?? "Failed to add connection");
    toast.success(`Connected: ${connName}`);
    setConnName(""); setConnUrl(""); setConnKey(""); setConnModels(""); setShowConnForm(false);
    router.refresh();
  }

  function startEdit(c: { id: string; name: string; provider: string; baseUrl: string; models: string | null; lastTestedAt: string | null; lastTestStatus: string | null }) {
    const modelList = c.models ? JSON.parse(c.models).join(", ") : "";
    setEditingConn({
      id: c.id,
      name: c.name,
      provider: c.provider,
      baseUrl: c.baseUrl,
      models: modelList,
      apiKey: "", // Don't pre-fill the key; user must re-enter if changing
    });
  }

  function cancelEdit() {
    setEditingConn(null);
  }

  async function saveEdit() {
    if (!editingConn) return;
    if (!editingConn.name.trim() || !editingConn.baseUrl.trim()) {
      return toast.error("Name and URL are required");
    }
    setBusy(true);
    const body: Record<string, unknown> = {
      id: editingConn.id,
      name: editingConn.name.trim(),
      provider: editingConn.provider,
      baseUrl: editingConn.baseUrl.trim(),
    };
    if (editingConn.models !== null && editingConn.models !== undefined) {
      body.modelIds = editingConn.models.split(",").map((m) => m.trim()).filter(Boolean);
    }
    if (editingConn.apiKey.trim()) {
      body.apiKey = editingConn.apiKey.trim();
    }
    const res = await fetch("/api/organizations/ai-connections", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.error ?? data.message ?? "Failed to update connection");
    toast.success(`Updated: ${editingConn.name}`);
    setEditingConn(null);
    router.refresh();
  }

  async function toggleConnection(id: string, isActive: boolean) {
    await fetch("/api/organizations/ai-connections", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, isActive }),
    });
    router.refresh();
  }

  async function removeConnection(id: string) {
    await fetch("/api/organizations/ai-connections", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Connection removed");
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

  /** Number inputs stay valid: an empty or bad value falls back to the minimum. */
  const positiveInt = (raw: string, min = 1) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= min ? n : min;
  };
  const toggleAllowedModel = (key: string, on: boolean) =>
    setS((x) => ({
      ...x,
      agentAllowedModels: on ? [...new Set([...x.agentAllowedModels, key])] : x.agentAllowedModels.filter((m) => m !== key),
    }));

  function statusBadge(status: string | null) {
    if (!status) return <Badge variant="secondary">untested</Badge>;
    return status === "ok" ? (
      <Badge className="bg-emerald-100 text-emerald-700">connected</Badge>
    ) : (
      <Badge variant="destructive">error</Badge>
    );
  }

  function providerIcon(p: string) {
    const upper = p.toUpperCase();
    if (upper.includes("OPENAI")) return "🟢";
    if (upper.includes("ANTHROPIC") || upper.includes("CLAUDE")) return "🟣";
    if (upper.includes("GOOGLE") || upper.includes("GEMINI")) return "🔵";
    return "🔗";
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>{organization.name} · /{organization.slug}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <Label>Default timezone</Label>
            <Input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} placeholder="Europe/London" />
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
            <Switch checked={s.whatsappRequireHumanApproval} onCheckedChange={(v) => setS({ ...s, whatsappRequireHumanApproval: v })} />
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
          <CardDescription>Used when a member does not pick a model. Platform defaults apply otherwise.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1">
            <Label>Text model</Label>
            <Select value={modelValue(s.aiDefaultProvider, s.aiDefaultModel)} onValueChange={(v) => setModel("text", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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
              <SelectTrigger><SelectValue /></SelectTrigger>
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
        </CardContent>
      </Card>

      {/* AI Connections - The main feature */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>AI Connections</CardTitle>
          <CardDescription>
            Connect any AI provider or proxy. Each connection has its own API key, URL and model list.
            Keys are encrypted at rest and never leave the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Existing connections */}
          {connections.length > 0 && (
            <div className="grid gap-2">
              {connections.map((c) => (
                <div key={c.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg shrink-0">{providerIcon(c.provider)}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.provider} · {c.baseUrl.replace(/https?:\/\//, "")}
                        </div>
                        {(() => {
                          try {
                            const modelList = c.models ? JSON.parse(c.models) : [];
                            if (modelList.length > 0) {
                              return (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {modelList.slice(0, 8).map((m: string) => (
                                    <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{m}</span>
                                  ))}
                                  {modelList.length > 8 && (
                                    <span className="text-[10px] text-muted-foreground">+{modelList.length - 8} more</span>
                                  )}
                                </div>
                              );
                            }
                            return <div className="text-[10px] text-muted-foreground mt-0.5">No models configured — will auto-detect</div>;
                          } catch {
                            return null;
                          }
                        })()}
                        <div className="flex items-center gap-2 mt-1">
                          {statusBadge(c.lastTestStatus)}
                          {c.lastTestedAt && (
                            <span className="text-[10px] text-muted-foreground">
                              tested {new Date(c.lastTestedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(c)} title="Edit connection">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </Button>
                      <Switch
                        checked={c.isActive}
                        onCheckedChange={(v) => toggleConnection(c.id, v)}
                        title={c.isActive ? "Active" : "Disabled"}
                      />
                      <Button size="sm" variant="ghost" onClick={() => removeConnection(c.id)} title="Remove">Remove</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add connection form */}
          {!showConnForm ? (
            <Button variant="outline" onClick={() => setShowConnForm(true)} className="w-full">
              + Add AI connection
            </Button>
          ) : (
            <div className="grid gap-3 rounded-md border p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1">
                  <Label>Connection name</Label>
                  <Input placeholder="My OpenAI Proxy" value={connName} onChange={(e) => setConnName(e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label>Provider name</Label>
                  <Input
                    placeholder="OpenAI, Anthropic, Groq, Ollama, or any name"
                    value={connProvider}
                    onChange={(e) => setConnProvider(e.target.value)}
                    list="provider-suggestions"
                  />
                  <datalist id="provider-suggestions">
                    {PROVIDERS_LIST.map((p) => p && <option key={p} value={p} />)}
                  </datalist>
                </div>
              </div>
              <div className="grid gap-1">
                <Label>API base URL</Label>
                <Input placeholder="https://claude.opuscode.pro/api" value={connUrl} onChange={(e) => setConnUrl(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>API key</Label>
                <Input type="password" placeholder="sk-..." value={connKey} onChange={(e) => setConnKey(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>Available models (comma-separated, optional)</Label>
                <Input placeholder="claude-opus-5, claude-sonnet-5, gpt-5" value={connModels} onChange={(e) => setConnModels(e.target.value)} />
                <span className="text-xs text-muted-foreground">Leave empty to auto-detect from the provider.</span>
              </div>
              <div className="flex gap-2">
                <Button onClick={addConnection} disabled={busy || !connName || !connUrl || !connKey}>
                  {busy ? "Testing & saving…" : "Connect"}
                </Button>
                <Button variant="ghost" onClick={() => { setShowConnForm(false); setConnName(""); setConnUrl(""); setConnKey(""); setConnModels(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Edit connection dialog */}
          <Dialog open={!!editingConn} onOpenChange={(open) => !open && cancelEdit()}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit connection</DialogTitle>
                <DialogDescription>Update this AI connection&apos;s details.</DialogDescription>
              </DialogHeader>
              {editingConn && (
                <div className="grid gap-3 py-2">
                  <div className="grid gap-1">
                    <Label>Connection name</Label>
                    <Input value={editingConn.name} onChange={(e) => setEditingConn({ ...editingConn, name: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label>Provider name</Label>
                    <Input value={editingConn.provider} onChange={(e) => setEditingConn({ ...editingConn, provider: e.target.value })} list="provider-suggestions-edit" />
                    <datalist id="provider-suggestions-edit">
                      {PROVIDERS_LIST.map((p) => p && <option key={p} value={p} />)}
                    </datalist>
                  </div>
                  <div className="grid gap-1">
                    <Label>API base URL</Label>
                    <Input value={editingConn.baseUrl} onChange={(e) => setEditingConn({ ...editingConn, baseUrl: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label>Available models (comma-separated)</Label>
                    <Input value={editingConn.models ?? ""} onChange={(e) => setEditingConn({ ...editingConn, models: e.target.value })} placeholder="claude-sonnet-5, gpt-5" />
                    <span className="text-xs text-muted-foreground">Leave empty to auto-detect from the provider.</span>
                  </div>
                  <div className="grid gap-1">
                    <Label>New API key (leave blank to keep current)</Label>
                    <Input type="password" value={editingConn.apiKey} onChange={(e) => setEditingConn({ ...editingConn, apiKey: e.target.value })} placeholder="Enter new key to rotate" />
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={cancelEdit} disabled={busy}>Cancel</Button>
                <Button onClick={saveEdit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Legacy BYO keys section */}
          <div className="border-t pt-4">
            <Label className="mb-2 block">Direct API keys (legacy)</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {keys.map((k) => (
                <Badge key={k.provider} variant="secondary" className="gap-2">
                  {k.provider} {k.label ? `· ${k.label}` : ""}
                  <button type="button" className="hover:text-destructive" onClick={() => removeKey(k.provider)}>×</button>
                </Badge>
              ))}
              {keys.length === 0 && <span className="text-xs text-muted-foreground">Using platform keys.</span>}
            </div>
            <div className="flex gap-2">
              <Select value={keyProvider} onValueChange={setKeyProvider}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPENAI">OpenAI</SelectItem>
                  <SelectItem value="ANTHROPIC">Anthropic</SelectItem>
                  <SelectItem value="GOOGLE">Google</SelectItem>
                </SelectContent>
              </Select>
              <Input type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="flex-1" />
              <Button variant="outline" onClick={addKey} disabled={busy || apiKey.length < 10}>Add</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Campaign automation</CardTitle>
          <CardDescription>
            Defaults for the Agent Council. Campaigns can lower these limits, never raise them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1">
            <Label>Publishing mode</Label>
            <Select
              value={s.agentPublishMode}
              onValueChange={(v) => setS({ ...s, agentPublishMode: v as AgentPublishMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Manual — recommendation only</SelectItem>
                <SelectItem value="APPROVAL_REQUIRED">Approval required — a human decides</SelectItem>
                <SelectItem value="AUTOMATIC">Automatic — publish without a human</SelectItem>
              </SelectContent>
            </Select>
            {s.agentPublishMode === "AUTOMATIC" && (
              <p className="text-xs text-amber-600">
                Campaigns can publish without review. It still requires the creator to have publish rights and each
                account to allow auto-publishing.
              </p>
            )}
          </div>
          <div className="grid gap-1">
            <Label>Assurance level</Label>
            <Select value={s.agentAssurance} onValueChange={(v) => setS({ ...s, agentAssurance: v as AgentAssurance })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="JUDGE_ONLY">Judge only — faster and cheaper</SelectItem>
                <SelectItem value="HIGH_ASSURANCE">High assurance — adds cross-review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="agentRunMaxCents">Maximum spend per campaign (cents)</Label>
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
            <span className="text-xs text-muted-foreground">Reservations stop campaigns before this is exceeded.</span>
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
            <span className="text-xs text-muted-foreground">
              Select none to allow any model this organization can reach.
            </span>
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

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Configurable permissions</CardTitle>
          <CardDescription>Capabilities the matrix marks as &quot;Configured&quot;.</CardDescription>
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
                        onChange={(on) =>
                          setS((x) => {
                            const cur = new Set(x.permissionOverrides[role] ?? []);
                            if (on) cur.add(c); else cur.delete(c);
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
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
      </div>
    </div>
  );
}
