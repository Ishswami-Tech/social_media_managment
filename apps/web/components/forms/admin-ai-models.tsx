"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DiscoveredModel {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  capabilities: string[];
  inputCostPerM: number;
  outputCostPerM: number;
  imageCost: number;
  active: boolean;
  isDefault: boolean;
  priority: number;
  /** `connection:<name>` or `env`. */
  source: string;
}

function sourceLabel(source: string): string {
  return source === "env" ? "From environment" : source.slice("connection:".length);
}

/**
 * Models discovered from the configured providers. The table edits the overlay that
 * sits on top of discovery: cost, priority, default and whether routing may use it.
 */
export function AIModelTable({ models }: { models: DiscoveredModel[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function save(m: DiscoveredModel, changes: Partial<DiscoveredModel>) {
    const next = { ...m, ...changes };
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ai-providers/models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: next.provider,
          model: next.model,
          displayName: next.displayName,
          capabilities: next.capabilities,
          active: next.active,
          isDefault: next.isDefault,
          priority: next.priority,
          inputCostPerM: next.inputCostPerM,
          outputCostPerM: next.outputCostPerM,
          imageCost: next.imageCost,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        toast.error(data.message ?? "Could not save that change.");
        return;
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that change.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ai-providers/refresh", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        discovered?: number;
        created?: number;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Could not reach the providers.");
        return;
      }
      toast.success(`Found ${data.discovered ?? 0} models, ${data.created ?? 0} of them new.`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach the providers.");
    } finally {
      setBusy(false);
    }
  }

  /** Number fields save on blur so typing does not fire a request per keystroke. */
  function numberCell(m: DiscoveredModel, field: "inputCostPerM" | "outputCostPerM" | "imageCost" | "priority") {
    return (
      <Input
        type="number"
        min={0}
        step={field === "priority" ? 1 : 0.01}
        defaultValue={m[field]}
        disabled={busy}
        className="h-8 w-24 tabular-nums"
        onBlur={(e) => {
          const value = Number(e.target.value);
          if (Number.isFinite(value) && value !== m[field]) void save(m, { [field]: value });
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Models</CardTitle>
        <CardDescription>
          Everything the providers above currently serve. Set a cost to make it count towards budgets, and mark a default
          so automatic choices land on it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div>
          <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
            {busy ? "Refreshing…" : "Refresh from providers"}
          </Button>
        </div>
        {models.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Add a provider to see its models.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Can do</TableHead>
                <TableHead>Cost in / out per 1M</TableHead>
                <TableHead>Per image</TableHead>
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
                    <span className="text-xs text-muted-foreground">{m.model}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm">{sourceLabel(m.source)}</span>
                    <span className="text-xs text-muted-foreground">{m.provider}</span>
                  </TableCell>
                  <TableCell className="space-x-1">
                    {m.capabilities.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    {numberCell(m, "inputCostPerM")}
                    {numberCell(m, "outputCostPerM")}
                  </TableCell>
                  <TableCell>{numberCell(m, "imageCost")}</TableCell>
                  <TableCell>{numberCell(m, "priority")}</TableCell>
                  <TableCell>
                    <Switch
                      checked={m.isDefault}
                      disabled={busy}
                      aria-label={`Make ${m.displayName} the default`}
                      onCheckedChange={(v) => save(m, { isDefault: v, active: v ? true : m.active })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={m.active}
                      disabled={busy}
                      aria-label={`Allow ${m.displayName}`}
                      onCheckedChange={(v) => save(m, { active: v })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
