"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Super Admin action: pull live model lists from each configured provider into the catalogue. */
export function RefreshModelsButton() {
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ai-providers", { method: "PATCH" });
      const data = (await res.json()) as { ok?: boolean; added?: number; message?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.message ?? "Failed to refresh models");
        return;
      }
      toast.success(`Added ${data.added ?? 0} new models`);
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh models");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
      {busy ? "Refreshing…" : "Refresh from providers"}
    </Button>
  );
}
