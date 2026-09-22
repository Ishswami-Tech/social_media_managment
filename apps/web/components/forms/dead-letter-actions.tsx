"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface RetryResponse {
  ok?: boolean;
  queue?: string;
  jobId?: string;
  message?: string;
}

/** Re-enqueues a parked job on its original queue and removes the dead-letter entry. */
export function DeadLetterRetry({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    const res = await fetch("/api/admin/dead-letter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = (await res.json().catch(() => ({}))) as RetryResponse;
    setBusy(false);
    if (!res.ok) return toast.error(data.message ?? "Retry failed");
    if (!data.queue) return toast.warning("That entry no longer exists");
    toast.success(`Re-enqueued on ${data.queue}`);
    router.refresh();
  }

  return (
    <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
      {busy ? "Retrying…" : "Retry"}
    </Button>
  );
}
