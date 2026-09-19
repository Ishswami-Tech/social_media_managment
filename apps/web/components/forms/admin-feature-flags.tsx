"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface Flag {
  key: string;
  description: string;
  enabled: boolean;
  organizationIds: string[];
}

export function FeatureFlags({ flags }: { flags: Flag[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ key: "", description: "" });

  async function save(flag: Flag) {
    const res = await fetch("/api/admin/feature-flags", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(flag),
    });
    if (!res.ok) return toast.error("Save failed");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        {flags.map((f) => (
          <div key={f.key} className="flex items-center justify-between rounded-md border p-3">
            <span>
              <span className="block font-mono text-sm font-medium">{f.key}</span>
              <span className="text-xs text-muted-foreground">
                {f.description} {f.organizationIds.length > 0 && `· ${f.organizationIds.length} org(s) allow-listed`}
              </span>
            </span>
            <Switch checked={f.enabled} onCheckedChange={(v) => save({ ...f, enabled: v })} />
          </div>
        ))}
        <div className="flex gap-2 border-t pt-3">
          <Input
            placeholder="new_flag_key"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value.replace(/[^a-z0-9_]/g, "") })}
          />
          <Input
            placeholder="Description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <Button onClick={() => save({ ...draft, enabled: false, organizationIds: [] })} disabled={!draft.key}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
