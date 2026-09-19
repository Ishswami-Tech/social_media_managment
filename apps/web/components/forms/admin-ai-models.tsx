"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Model {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  capabilities: string[];
  active: boolean;
  isDefault: boolean;
  priority: number;
  inputCostPerM: number;
  outputCostPerM: number;
  imageCost: number;
}

export function AIModelTable({ models, platformKeys }: { models: Model[]; platformKeys: Record<string, boolean> }) {
  const router = useRouter();
  const [health, setHealth] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    provider: "OPENAI",
    model: "",
    displayName: "",
    capabilities: "text,json",
    inputCostPerM: "0",
    outputCostPerM: "0",
    imageCost: "0",
  });

  async function upsert(m: Partial<Model> & { provider: string; model: string }) {
    const res = await fetch("/api/admin/ai-providers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(m),
    });
    if (!res.ok) return toast.error((await res.json()).message ?? "Failed");
    toast.success("Model saved");
    router.refresh();
  }

  async function check(provider: string) {
    const res = await fetch("/api/admin/ai-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const data = await res.json();
    setHealth((h) => ({ ...h, [provider]: data.ok ? "ok" : `error: ${data.message ?? "unknown"}` }));
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {["OPENAI", "ANTHROPIC", "GOOGLE"].map((p) => (
          <Card key={p} className="gap-2 py-4">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-sm">
                {p}
                <Badge variant={platformKeys[p] ? "success" : "outline"}>
                  {platformKeys[p] ? "key configured" : "no platform key"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{health[p] ?? ""}</span>
              <Button size="sm" variant="outline" onClick={() => check(p)} disabled={!platformKeys[p]}>
                Health check
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Model catalogue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Cost in/out per 1M · image</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <span className="block font-medium">{m.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.provider} · {m.model}
                    </span>
                  </TableCell>
                  <TableCell className="space-x-1">
                    {m.capabilities.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    ${m.inputCostPerM} / ${m.outputCostPerM} · ${m.imageCost}
                  </TableCell>
                  <TableCell>{m.priority}</TableCell>
                  <TableCell>
                    <Switch checked={m.isDefault} onCheckedChange={(v) => upsert({ ...m, isDefault: v })} />
                  </TableCell>
                  <TableCell>
                    <Switch checked={m.active} onCheckedChange={(v) => upsert({ ...m, active: v })} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add model</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-7">
          <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["OPENAI", "ANTHROPIC", "GOOGLE"].map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="model id"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <Input
            placeholder="display name"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <Input
            placeholder="capabilities (text,json,vision,image,embedding)"
            value={form.capabilities}
            onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
          />
          <Input
            placeholder="$ in / 1M"
            value={form.inputCostPerM}
            onChange={(e) => setForm({ ...form, inputCostPerM: e.target.value })}
          />
          <Input
            placeholder="$ out / 1M"
            value={form.outputCostPerM}
            onChange={(e) => setForm({ ...form, outputCostPerM: e.target.value })}
          />
          <Button
            onClick={() =>
              upsert({
                provider: form.provider,
                model: form.model,
                displayName: form.displayName || form.model,
                capabilities: form.capabilities
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean),
                inputCostPerM: Number(form.inputCostPerM) || 0,
                outputCostPerM: Number(form.outputCostPerM) || 0,
                imageCost: Number(form.imageCost) || 0,
                active: true,
                isDefault: false,
                priority: 100,
              })
            }
            disabled={!form.model}
          >
            Add
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
