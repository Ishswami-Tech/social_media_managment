"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2, MoreHorizontal, ShieldAlert, ShieldCheck, Trash2, X } from "lucide-react";
import { PlatformIcon } from "@/components/app/platform-icon";
import { ViewSwitch } from "@/components/home/today-bar";
import { dayLabel, timeLabel } from "@/lib/utils";
import type { WaitingItem } from "@/lib/home/overview";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

const ASSURANCE: Record<string, string> = { JUDGE_ONLY: "Judge only", HIGH_ASSURANCE: "High assurance" };

function goesOut(item: WaitingItem, timeZone: string): string {
  if (!item.goesOutAt) return "goes out when you approve";
  return `goes out ${dayLabel(item.goesOutAt, timeZone)}, ${timeLabel(item.goesOutAt, timeZone)}`;
}

/**
 * One card per campaign waiting for a decision: what it is, how it was
 * checked, and what can be done with it.
 *
 * Three outcomes, which are not the same thing. Approve sends it. Reject says
 * no to this draft and, given a reason, teaches the accounts what to avoid
 * next time. Discard throws the whole campaign away without teaching it
 * anything, for the ones that were a bad idea rather than a bad draft.
 */
export function AlsoWaiting({
  items,
  timeZone,
  canDecide,
  canReview = true,
}: {
  items: WaitingItem[];
  timeZone: string;
  /** Run ids this person may approve from here. */
  canDecide: string[];
  /** Whether this person may open the review page (read-only roles may not). */
  canReview?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function approve(item: WaitingItem) {
    setBusy(item.runId);
    try {
      const res = await fetch(`/api/agent/runs/${item.runId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountIds: item.pendingAccountIds, decision: "APPROVED" }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(body.message ?? "Could not approve. Try again.");
        return;
      }
      toast.success(`Approved. ${item.goesOutAt ? "It goes out on schedule." : "It goes out shortly."}`);
      router.refresh();
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** Says no to this draft. A reason is optional, and becomes a preference the accounts keep. */
  async function reject(item: WaitingItem, reason: string): Promise<boolean> {
    setBusy(item.runId);
    try {
      const res = await fetch(`/api/agent/runs/${item.runId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountIds: item.pendingAccountIds,
          decision: "REJECTED",
          ...(reason.trim() ? { comment: reason.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(body.message ?? "Could not reject. Try again.");
        return false;
      }
      toast.success(reason.trim() ? "Rejected. The council will remember why." : "Rejected. Nothing goes out.");
      router.refresh();
      return true;
    } catch {
      toast.error("Could not reach the server. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Throws the campaign away outright: no post, no learning signal, gone from the list. */
  async function discard(item: WaitingItem): Promise<boolean> {
    setBusy(item.runId);
    try {
      const res = await fetch(`/api/agent/runs/${item.runId}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(body.message ?? "Could not discard. Try again.");
        return false;
      }
      toast.success("Discarded.");
      router.refresh();
      return true;
    } catch {
      toast.error("Could not reach the server. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {items.map((item) => (
        <article key={item.runId} className="flex flex-wrap items-start gap-[18px] rounded-[14px] border border-border bg-card p-5">
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex gap-1">
                {item.platforms.map((p, i) => (
                  <PlatformIcon key={`${p}${i}`} platform={p} className="size-6 text-[9px]" />
                ))}
              </span>
              <span className="text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                {item.accounts.length} account{item.accounts.length === 1 ? "" : "s"} · {goesOut(item, timeZone)}
              </span>
            </div>
            <h3 className="font-display text-[18px] leading-[1.3] font-bold tracking-[-0.01em]">{item.topic}</h3>
            {item.excerpt && <p className="line-clamp-2 text-[14px] leading-normal text-[#454B53] dark:text-muted-foreground">{item.excerpt}</p>}
            <ViewSwitch
              simple={
                item.checksClean === false ? (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-warn">
                    <ShieldAlert className="size-3.5" aria-hidden /> {item.issues} thing{item.issues === 1 ? "" : "s"} to look at before it goes out
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-success">
                    <ShieldCheck className="size-3.5" aria-hidden /> Checked for facts, tone and platform rules
                  </span>
                )
              }
              detailed={
                <span className="flex flex-wrap gap-3.5 font-mono text-[12px] text-[#454B53] dark:text-muted-foreground">
                  {item.score !== null && <span>Verdict {item.score.toFixed(1)}</span>}
                  <span>{item.checksClean === null ? "Checks —" : item.checksClean ? "Checks clear" : `Checks ${item.issues} issue${item.issues === 1 ? "" : "s"}`}</span>
                  <span>{ASSURANCE[item.assurance] ?? item.assurance}</span>
                  <span>${(item.spentCents / 100).toFixed(2)}</span>
                  <span>
                    {item.models} model{item.models === 1 ? "" : "s"}
                  </span>
                  <span>waiting {ago(item.waitingSince)}</span>
                </span>
              }
            />
          </div>
          <div className="flex min-w-[150px] flex-col items-stretch gap-2">
            {canDecide.includes(item.runId) && (
              <>
                <Button variant="signal" size="sm" disabled={busy === item.runId} onClick={() => void approve(item)}>
                  {busy === item.runId ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Approve
                </Button>
                <RejectDialog item={item} busy={busy === item.runId} onReject={reject} />
              </>
            )}
            {canReview && (
              <Button variant="outline" size="sm" asChild>
                {/* The review page is where the text is edited, so this is also the Edit route. */}
                <Link href={`/review/${item.runId}`}>Read and edit</Link>
              </Button>
            )}
            {canDecide.includes(item.runId) && (
              <DiscardMenu item={item} busy={busy === item.runId} onDiscard={discard} />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Rejecting asks why, because the answer is worth more than the rejection:
 * it is stored against the accounts and shapes later drafts. The field is
 * optional so a reason is never the price of saying no.
 */
function RejectDialog({
  item,
  busy,
  onReject,
}: {
  item: WaitingItem;
  busy: boolean;
  onReject: (item: WaitingItem, reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function confirm() {
    if (await onReject(item, reason)) {
      setOpen(false);
      setReason("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          <X aria-hidden /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-1 rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[20px]">Reject this draft?</DialogTitle>
          <DialogDescription>
            Nothing goes out. {item.topic ? `“${item.topic}” stays` : "It stays"} in your history, and you can ask the council to
            try again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-1.5">
          <label htmlFor={`reject-${item.runId}`} className="text-[13px] font-medium">
            What was wrong with it? <span className="font-normal text-muted-foreground">Optional</span>
          </label>
          <Textarea
            id={`reject-${item.runId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Too salesy. Open on a real moment instead."
            disabled={busy}
          />
          <p className="text-[12.5px] text-muted-foreground">
            Whatever you write here is remembered for these accounts, so the next draft avoids it.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Keep it
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />} Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Discard is kept behind a menu and then a confirmation: it is the only action
 * here that throws away the whole campaign, research and all.
 */
function DiscardMenu({
  item,
  busy,
  onDiscard,
}: {
  item: WaitingItem;
  busy: boolean;
  onDiscard: (item: WaitingItem) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);

  async function confirm() {
    if (await onDiscard(item)) setOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy} aria-label="More actions">
            <MoreHorizontal aria-hidden /> More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen(true)}>
            <Trash2 aria-hidden /> Discard campaign
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="grid-cols-1 rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-[20px]">Discard this campaign?</DialogTitle>
            <DialogDescription>
              The drafts, the research and the council&apos;s work are thrown away, and nothing is learned from it. Reject
              instead if the idea was right and only the writing was wrong.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                Keep it
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />} Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ApproveAllResponse {
  approved?: { runId: string; accounts: number }[];
  skipped?: { runId: string; reason: string }[];
  message?: string;
}

/**
 * Approves every listed post in one go, after a confirmation that names what
 * will happen. Only the posts on screen are sent, so nothing that arrived
 * since the page loaded is approved unseen.
 */
export function ApproveAllButton({ items }: { items: WaitingItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const posts = items.reduce((sum, i) => sum + Math.max(1, i.accounts.length), 0);
  if (items.length === 0) return null;

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/agent/approve-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runIds: items.map((i) => i.runId) }),
      });
      const body = (await res.json().catch(() => ({}))) as ApproveAllResponse;
      if (!res.ok) {
        toast.error(body.message ?? "Could not approve. Try again.");
        return;
      }
      const approved = body.approved?.length ?? 0;
      const skipped = body.skipped ?? [];
      if (approved > 0) toast.success(`Approved ${approved} ${approved === 1 ? "campaign" : "campaigns"}. They'll go out on schedule.`);
      if (skipped.length > 0)
        toast.warning(`${skipped.length} skipped: ${[...new Set(skipped.map((s) => s.reason))].join("; ")}`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CheckCheck aria-hidden /> Approve all {items.length}
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-1 rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[20px]">
            Approve {items.length} {items.length === 1 ? "campaign" : "campaigns"}?
          </DialogTitle>
          <DialogDescription>
            {posts} {posts === 1 ? "post" : "posts"} will be scheduled exactly as the council recommended. Anything you started
            yourself is skipped unless you are an owner or admin.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid min-w-0 grid-cols-1 max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2 text-[14px]">
          {items.map((item) => (
            <li key={item.runId} className="flex items-center gap-2 px-2 py-1">
              <span className="size-1.5 shrink-0 rounded-full bg-signal" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.topic}</span>
              {item.score !== null && <span className="font-mono text-[12px] text-muted-foreground">{item.score}</span>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="signal" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />}
            Approve all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
