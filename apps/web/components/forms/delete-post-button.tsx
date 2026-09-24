"use client";

/**
 * Deletes a post after an explicit confirmation. For a live post the dialog
 * offers to take it down on the connected platform first; that call goes to
 * the real platform, so it stays behind the user's own click.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface DeletePostButtonProps {
  postId: string;
  status: string;
  /** Publish rights are needed to take a live post down before deleting it. */
  canRemoveFromPlatforms: boolean;
  /** Where to go once the post is gone; the current page refreshes when unset. */
  redirectTo?: string;
  /** Icon-only trigger for table rows. */
  compact?: boolean;
}

/** A worker may be mid-flight in these states; the Cancel action comes first. */
const BLOCKED_STATUSES = new Set(["QUEUED", "PUBLISHING"]);

interface DeleteResponse {
  message?: string;
  removed?: { platform: string }[];
  stillLive?: boolean;
}

export function DeletePostButton({ postId, status, canRemoveFromPlatforms, redirectTo, compact }: DeletePostButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [takeDown, setTakeDown] = useState(true);
  if (BLOCKED_STATUSES.has(status)) return null;

  const live = status === "PUBLISHED";
  const removing = live && canRemoveFromPlatforms && takeDown;

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}${removing ? "?removeFromPlatforms=1" : ""}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as DeleteResponse;
      if (!res.ok) {
        toast.error(data.message ?? "Could not delete the post");
        return;
      }
      setOpen(false);
      if (removing && data.stillLive) toast.warning("Deleted here, but the platform copy could not be removed");
      else toast.success(removing ? "Taken down and deleted" : "Post deleted");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label="Delete post"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10">
            <Trash2 className="size-4" /> Delete post
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this post?</DialogTitle>
          <DialogDescription>
            {live
              ? "The post is live. Deleting it here removes it from your history and the calendar."
              : "This removes the post, its drafts and its schedule. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        {live && canRemoveFromPlatforms && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={takeDown} onCheckedChange={(v) => setTakeDown(v === true)} className="mt-0.5" />
            <span>
              Also take it down on the connected platform
              <span className="block text-xs text-muted-foreground">
                Reactions and comments on it are lost. Unchecked, the live post stays up.
              </span>
            </span>
          </label>
        )}
        {live && !canRemoveFromPlatforms && (
          <p className="text-xs text-muted-foreground">You cannot take live posts down, so the platform copy stays up.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {removing ? "Take down and delete" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
