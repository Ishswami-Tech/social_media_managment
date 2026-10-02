"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Check, ImageIcon, Loader2, X } from "lucide-react";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";

export interface ApprovalAccount {
  id: string;
  platform: string;
  displayName: string;
  finalText: string | null;
  finalHashtags: string[];
  mediaConcept: string | null;
  decision: string;
  verdict: number | null;
  checksClear: boolean | null;
}

interface Props {
  token: string;
  runId: string;
  run: { topic: string; goal: string; status: string; organizationName: string; scheduledAt: string | null };
  /** Pre-formatted on the server so the text matches after hydration. */
  goesOutLabel: string;
  accounts: ApprovalAccount[];
  expiresAt: string;
}

interface ApproveResponse {
  run?: { id: string; status: string };
  message?: string;
}

type Outcome = { kind: "APPROVED" | "REJECTED"; status: string } | { kind: "ERROR"; message: string };

function hoursLeft(iso: string): string {
  const h = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} hour${h === 1 ? "" : "s"}`;
}

/**
 * The page an emailed approval link opens: built for a phone. One card per
 * post, one big Approve, and "Edit in app" for anything more.
 */
export function ApprovalPage({ token, runId, accounts, expiresAt, goesOutLabel, run }: Props) {
  const pending = accounts.filter((a) => a.decision === "PENDING");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const goesOut = goesOutLabel;

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (pending.length === 0 || busy) return;
    setBusy(true);
    const res = await fetch("/api/agent/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, decision, accountIds: pending.map((a) => a.id) }),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => ({}))) ?? {}) as ApproveResponse;
    setBusy(false);
    if (!res?.ok || !data.run) {
      const message = data.message ?? "Could not record your decision";
      setOutcome({ kind: "ERROR", message });
      toast.error(message);
      return;
    }
    setOutcome({ kind: decision, status: data.run.status });
  }

  if (outcome && outcome.kind !== "ERROR") {
    return (
      <div className="flex flex-col gap-3 px-5 py-10 text-center">
        <span className={`mx-auto inline-flex size-14 items-center justify-center rounded-full ${outcome.kind === "APPROVED" ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
          {outcome.kind === "APPROVED" ? <Check className="size-7" aria-hidden /> : <X className="size-7" aria-hidden />}
        </span>
        <h1 className="font-display text-[26px] font-bold">{outcome.kind === "APPROVED" ? "Approved." : "Rejected."}</h1>
        <p className="text-[15px] text-muted-foreground">
          {outcome.kind === "APPROVED" ? `It goes out ${goesOut}.` : "Nothing will be published. The council learns from it."} This link has now been used.
        </p>
        <Link href="/home" className="text-[14px] underline underline-offset-2">
          Open the app
        </Link>
      </div>
    );
  }

  const first = pending[0] ?? accounts[0];
  const others = pending.slice(1);
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 px-5 pt-5 pb-4">
        <h1 className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.02em]">
          {pending.length === 0 ? "Already decided." : pending.length === 1 ? "One post is ready for you." : `${pending.length} posts are ready for you.`}
        </h1>
        {outcome?.kind === "ERROR" && <p className="rounded-lg bg-danger-soft px-4 py-2.5 text-sm text-danger">{outcome.message}</p>}
        {first && (
          <>
            <div className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <PlatformIcon platform={first.platform} className="size-[22px] text-[9px]" />
              <span className="flex-1">
                {first.displayName} · goes out <strong className="font-semibold text-foreground">{goesOut}</strong>
              </span>
            </div>
            <article className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4">
              {first.finalText ? (
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{first.finalText}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No text yet.</p>
              )}
              {first.finalHashtags.length > 0 && <p className="text-[14px] text-info">{first.finalHashtags.map((h) => `#${h}`).join(" ")}</p>}
              {first.mediaConcept && (
                <div className="flex items-center justify-center gap-2 rounded-[10px] bg-[#1B1E23] px-4 py-8 text-center text-[13px] text-[#C3C8CF]">
                  <ImageIcon className="size-4 shrink-0" aria-hidden /> {first.mediaConcept}
                </div>
              )}
            </article>
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-agent-verdict text-[10px] font-bold text-white dark:text-[#111316]">V</span>
              {[
                first.verdict !== null ? `Verdict ${first.verdict.toFixed(1)}` : null,
                first.checksClear === null ? null : first.checksClear ? "checks clear" : "some checks need a look",
                others.length ? `also going to ${others.map((o) => o.displayName).join(", ")}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || run.topic}
            </p>
          </>
        )}
      </div>

      {pending.length > 0 && (
        <div className="sticky bottom-0 mt-auto flex flex-col gap-2.5 border-t border-border bg-card px-5 pt-4 pb-5">
          <Button variant="signal" size="lg" className="h-[52px] w-full text-[16px]" onClick={() => void decide("APPROVED")} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} {pending.length > 1 ? `Approve all ${pending.length}` : "Approve"}
          </Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline" size="lg" asChild>
              <Link href={`/review/${runId}`}>Edit in app</Link>
            </Button>
            <Button variant="outline" size="lg" className="border-[#E8C4C4] text-danger hover:bg-danger-soft" onClick={() => void decide("REJECTED")} disabled={busy}>
              Reject
            </Button>
          </div>
          <p className="text-center text-[12.5px] text-muted-foreground" suppressHydrationWarning>
            This link works once and expires in {hoursLeft(expiresAt)}.
          </p>
        </div>
      )}
    </div>
  );
}
