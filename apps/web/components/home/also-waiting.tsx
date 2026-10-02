"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { PlatformIcon } from "@/components/app/platform-icon";
import { ViewSwitch } from "@/components/home/today-bar";
import { dayLabel, timeLabel } from "@/lib/utils";
import type { WaitingItem } from "@/lib/home/overview";
import { Button } from "@/components/ui/button";
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

/** One card per campaign waiting for a decision: what it is, how it was checked, and Approve / Review first. */
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
              <Button variant="signal" size="sm" disabled={busy === item.runId} onClick={() => void approve(item)}>
                {busy === item.runId ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} Approve
              </Button>
            )}
            {canReview && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/review/${item.runId}`}>Review first</Link>
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
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
