"use client";

/** Override the judge: take this draft through the platform pass instead of the winner. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function UseDraftButton({ runId, accountId, draftId, label }: { runId: string; accountId: string; draftId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function choose() {
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/runs/${runId}/use-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, draftId }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? "Could not switch drafts");
      toast.success(`Draft ${label} is now the post`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch drafts");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void choose()} disabled={busy}>
      {busy && <Loader2 className="animate-spin" aria-hidden />} Use draft {label} instead
    </Button>
  );
}
