"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ConnectorRow {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  configured: boolean;
  source: "organization" | "platform" | null;
}

export function ConnectorSettings({ connectors }: { connectors: ConnectorRow[] }) {
  const router = useRouter();
  const [connector, setConnector] = useState(connectors[0]?.id ?? "TAVILY");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    const res = await fetch("/api/organizations/connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector, apiKey }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Key rejected");
    toast.success("Connector key stored (encrypted)");
    setApiKey("");
    router.refresh();
  }
  async function remove(id: string) {
    await fetch("/api/organizations/connectors", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector: id }),
    });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Research connectors</CardTitle>
        <CardDescription>
          Sources the AI can search when researching topics, competitors and trends. URL and RSS reading are always
          available.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          {connectors.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>
                <span className="font-medium">{c.name}</span>
                <span className="block text-xs text-muted-foreground">{c.description}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={c.configured ? "success" : "outline"}>
                  {c.configured ? (c.source === "organization" ? "your key" : "platform key") : "not configured"}
                </Badge>
                {c.source === "organization" && (
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                    Remove
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Select value={connector} onValueChange={setConnector}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connectors.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <Button variant="outline" onClick={add} disabled={busy || apiKey.length < 8}>
            {busy ? "Checking…" : "Add"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Keys are validated with a test search, then encrypted at rest. Your key takes precedence over the platform
          key.
        </p>
      </CardContent>
    </Card>
  );
}
