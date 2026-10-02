"use client";

/**
 * Acting on a post that is already live: react, comment, reshare.
 *
 * Each of these publishes to the real platform under the account's name, so
 * every one is an explicit click and the two that create visible content ask
 * for confirmation first. Nothing here happens in the background.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageCircle, Repeat2, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Action = "react" | "unreact" | "comment" | "repost";

interface EngageResponse {
  result?: { externalUrl?: string };
  message?: string;
}

export interface PostEngagementProps {
  postId: string;
  variantId: string;
  /** Disabled with a reason when the platform's API cannot do these. */
  platformLabel: string;
}

export function PostEngagement({ postId, variantId, platformLabel }: PostEngagementProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [repostOpen, setRepostOpen] = useState(false);
  const [commentary, setCommentary] = useState("");

  async function engage(body: Record<string, unknown>, success: string): Promise<EngageResponse | null> {
    setBusy(body.action as Action);
    try {
      const res = await fetch(`/api/posts/${postId}/variants/${variantId}/engage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as EngageResponse;
      if (!res.ok) {
        toast.error(data.message ?? `${platformLabel} refused that. Try again.`);
        return null;
      }
      toast.success(success);
      router.refresh();
      return data;
    } catch {
      toast.error("Could not reach the server. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => void engage({ action: "react", reaction: "LIKE" }, `Liked on ${platformLabel}.`)}
      >
        {busy === "react" ? <Loader2 className="animate-spin" aria-hidden /> : <ThumbsUp aria-hidden />} Like
      </Button>

      <Dialog open={commentOpen} onOpenChange={(next) => busy === null && setCommentOpen(next)}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy !== null}>
            <MessageCircle aria-hidden /> Comment
          </Button>
        </DialogTrigger>
        <DialogContent className="grid-cols-1 rounded-xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-[20px]">Comment on {platformLabel}</DialogTitle>
            <DialogDescription>
              This posts publicly, as the account that published the post. It cannot be edited from here afterwards.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={1250}
            placeholder="Add to the conversation…"
            disabled={busy !== null}
          />
          <p className="text-[12px] text-muted-foreground">{comment.length}/1250</p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy !== null}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="signal"
              disabled={busy !== null || comment.trim().length === 0}
              onClick={async () => {
                if (await engage({ action: "comment", text: comment.trim() }, "Comment posted.")) {
                  setComment("");
                  setCommentOpen(false);
                }
              }}
            >
              {busy === "comment" ? <Loader2 className="animate-spin" aria-hidden /> : <MessageCircle aria-hidden />} Post
              comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={repostOpen} onOpenChange={(next) => busy === null && setRepostOpen(next)}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy !== null}>
            <Repeat2 aria-hidden /> Repost
          </Button>
        </DialogTrigger>
        <DialogContent className="grid-cols-1 rounded-xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-[20px]">Reshare on {platformLabel}</DialogTitle>
            <DialogDescription>
              A new post goes out from this account carrying the original. Leave the note empty to reshare it as it is.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={commentary}
            onChange={(e) => setCommentary(e.target.value)}
            rows={3}
            maxLength={3000}
            placeholder="Say something about it… (optional)"
            disabled={busy !== null}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy !== null}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="signal"
              disabled={busy !== null}
              onClick={async () => {
                const body: Record<string, unknown> = { action: "repost" };
                if (commentary.trim()) body.commentary = commentary.trim();
                if (await engage(body, "Reshared.")) {
                  setCommentary("");
                  setRepostOpen(false);
                }
              }}
            >
              {busy === "repost" ? <Loader2 className="animate-spin" aria-hidden /> : <Repeat2 aria-hidden />} Reshare
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
