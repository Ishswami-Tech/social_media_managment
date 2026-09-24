"use client";

/**
 * The story bank: facts, numbers and anecdotes the writers may draw from.
 * Every entry rides inside the Account Brain of every campaign, so a story
 * added here can show up in the next post.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import type { Story } from "@/lib/services/memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StoryBank({ stories, canEdit }: { stories: Story[]; canEdit: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function add() {
    if (content.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await fetch("/api/memory/stories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(title.trim() ? { title: title.trim() } : {}), content: content.trim() }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "Could not save");
      setTitle("");
      setContent("");
      toast.success("Added to the story bank");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    try {
      const res = await fetch("/api/memory/stories", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not remove it");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove it");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <header>
        <h2 className="text-base font-semibold">Story bank</h2>
        <p className="text-sm text-muted-foreground">
          Real moments, numbers and lessons from your business. Writers pull from these instead of inventing, so the more specific the better.
        </p>
      </header>
      {canEdit && (
        <div className="grid gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional), e.g. The Tuesday queue" maxLength={200} />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What happened, with the specifics: who, when, the number, what changed."
          />
          <div>
            <Button size="sm" onClick={() => void add()} disabled={busy || content.trim().length < 3}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} Add to memory
            </Button>
          </div>
        </div>
      )}
      {stories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stories yet.</p>
      ) : (
        <ul className="grid gap-2">
          {stories.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/40 p-3 text-sm">
              <div className="grid gap-0.5">
                {s.title && <p className="font-medium">{s.title}</p>}
                <p className="whitespace-pre-wrap text-muted-foreground">{s.content}</p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  onClick={() => void remove(s.id)}
                  disabled={removing === s.id}
                  aria-label="Remove this story"
                  title="Remove"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
