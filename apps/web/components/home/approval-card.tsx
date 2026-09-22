"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ApprovalAccount {
  /** AgentRunAccount id. */
  id: string;
  platform: string;
  displayName: string;
  text: string;
}

interface Props {
  runId: string;
  topic: string;
  accounts: ApprovalAccount[];
  /** False when the viewer may not decide (no permission, or it is their own draft). */
  canDecide: boolean;
}

const PREVIEW_CHARS = 280;

interface ErrorBody {
  message?: string;
}

async function decide(runId: string, accountId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  const res = await fetch(`/api/agent/runs/${runId}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountIds: [accountId], decision, ...(comment ? { comment } : {}) }),
  });
  const data = (await res.json().catch(() => ({}))) as ErrorBody;
  return { ok: res.ok, message: data.message };
}

function AccountRow({ runId, account, canDecide }: { runId: string; account: ApprovalAccount; canDecide: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const long = account.text.length > PREVIEW_CHARS;
  const shown = expanded || !long ? account.text : `${account.text.slice(0, PREVIEW_CHARS)}…`;

  async function send(decision: "APPROVED" | "REJECTED", comment?: string) {
    setBusy(true);
    const { ok, message } = await decide(runId, account.id, decision, comment);
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "That did not work. Try again.");
      return;
    }
    toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
    setRejecting(false);
    setReason("");
    router.refresh();
  }

  return (
    <div className="grid gap-2 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <PlatformIcon platform={account.platform} />
        <span className="truncate">{account.displayName}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{shown}</p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="justify-self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {canDecide ? (
        rejecting ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional)"
              maxLength={2000}
              className="max-w-xs"
              autoFocus
            />
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => send("REJECTED", reason.trim() || undefined)}>
              Confirm reject
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => send("APPROVED")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/review/${runId}`}>Edit</Link>
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        )
      ) : (
        <p className="text-xs text-muted-foreground">Someone else on your team needs to review this one.</p>
      )}
    </div>
  );
}

export function ApprovalCard({ runId, topic, accounts, canDecide }: Props) {
  return (
    <article className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">
        <Link href={`/review/${runId}`} className="underline-offset-4 hover:underline">
          {topic}
        </Link>
      </h3>
      <div className="divide-y">
        {accounts.map((a) => (
          <AccountRow key={a.id} runId={runId} account={a} canDecide={canDecide} />
        ))}
      </div>
    </article>
  );
}
