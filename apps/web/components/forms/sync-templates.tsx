"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SyncTemplatesButton({ accountId, label }: { accountId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    const res = await fetch(`/api/whatsapp/accounts/${accountId}/sync-templates`, { method: "POST" });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Sync failed");
    toast.success(`Synced ${data.synced} template(s)`);
    router.refresh();
  }
  return (
    <Button variant="outline" onClick={sync} disabled={busy}>
      <RefreshCw className={busy ? "animate-spin" : ""} /> Sync {label}
    </Button>
  );
}
