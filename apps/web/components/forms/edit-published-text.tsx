"use client";

/** Edit the text of a post that is already live, in place, keeping its reactions and comments. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function EditPublishedText({ postId, variantId, text, maxLength }: { postId: string; variantId: string; text: string; maxLength: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const dirty = draft.trim() !== text.trim() && draft.trim().length > 0;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/variants/${variantId}/text`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? "Could not update the live post");
      toast.success("Live post updated");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the live post");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit live post
      </Button>
    );
  }
  return (
    <div className="grid gap-2">
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} maxLength={maxLength} aria-label="Live post text" />
      <p className="text-xs text-muted-foreground">
        {draft.length}/{maxLength} · The post keeps its reactions and comments; only the text changes.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={!dirty || busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />} Update live post
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setDraft(text), setOpen(false))} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
