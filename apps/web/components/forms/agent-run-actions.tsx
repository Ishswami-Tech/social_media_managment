"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Decision = "APPROVED" | "REJECTED";

interface ErrorBody {
  message?: string;
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as ErrorBody;
  return { ok: res.ok, message: data.message };
}

/** Statuses the worker can still be asked to stop. */
const PAUSABLE = new Set([
  "QUEUED",
  "RESEARCHING",
  "STRATEGIZING",
  "DRAFTING",
  "REVIEWING",
  "JUDGING",
  "ADAPTING",
  "AWAITING_APPROVAL",
  "APPROVED",
]);
const CANCELLABLE = new Set([...PAUSABLE, "PAUSED", "BLOCKED"]);

interface RunActionsProps {
  runId: string;
  status: string;
  /** `content:create` — lifecycle control. */
  canManage: boolean;
  /** `content:approve` — bulk decisions. */
  canApprove: boolean;
  /** AgentRunAccount ids still awaiting a decision. */
  pendingAccountIds: string[];
}

export function AgentRunActions({ runId, status, canManage, canApprove, pendingAccountIds }: RunActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  async function act(action: string, successMessage: string) {
    setBusy(true);
    const { ok, message } = await post(`/api/agent/runs/${runId}/${action}`);
    setBusy(false);
    if (!ok) return toast.error(message ?? "Action failed");
    toast.success(successMessage);
    router.refresh();
  }

  async function decideAll(decision: Decision) {
    if (pendingAccountIds.length === 0) return;
    if (
      decision === "REJECTED" &&
      !window.confirm(`Reject all ${pendingAccountIds.length} pending recommendation(s)?`)
    )
      return;
    setBusy(true);
    const { ok, message } = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: pendingAccountIds,
      decision,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
    setBusy(false);
    if (!ok) return toast.error(message ?? "Decision failed");
    toast.success(decision === "APPROVED" ? "All recommendations approved" : "All recommendations rejected");
    setComment("");
    router.refresh();
  }

  const canPause = canManage && PAUSABLE.has(status);
  const canResume = canManage && (status === "PAUSED" || status === "BLOCKED");
  const canCancel = canManage && CANCELLABLE.has(status);
  const canRetry = canManage && status === "FAILED";
  const showBulk = canApprove && status === "AWAITING_APPROVAL" && pendingAccountIds.length > 0;
  const nothing = !canPause && !canResume && !canCancel && !canRetry && !showBulk;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign actions</CardTitle>
        <CardDescription>Pausing stops the worker between stages; nothing in flight is lost.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {canPause && (
          <Button variant="outline" onClick={() => act("pause", "Campaign paused")} disabled={busy}>
            Pause
          </Button>
        )}
        {canResume && (
          <Button onClick={() => act("resume", "Campaign resumed")} disabled={busy}>
            Resume
          </Button>
        )}
        {canRetry && (
          <Button onClick={() => act("retry", "Campaign re-queued")} disabled={busy}>
            Retry
          </Button>
        )}
        {canCancel && (
          <Button variant="destructive" onClick={() => act("cancel", "Campaign cancelled")} disabled={busy}>
            Cancel
          </Button>
        )}
        {showBulk && (
          <div className="grid gap-2 border-t pt-3">
            <Label htmlFor="bulk-comment">Comment for every account (optional)</Label>
            <Input
              id="bulk-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Why you are approving or rejecting"
              maxLength={2000}
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => decideAll("APPROVED")} disabled={busy}>
                Approve all ({pendingAccountIds.length})
              </Button>
              <Button
                className="flex-1"
                variant="destructive"
                onClick={() => decideAll("REJECTED")}
                disabled={busy}
              >
                Reject all
              </Button>
            </div>
          </div>
        )}
        {nothing && <p className="text-sm text-muted-foreground">No actions available in this state for your role.</p>}
      </CardContent>
    </Card>
  );
}

interface AccountDecisionProps {
  runId: string;
  /** AgentRunAccount id. */
  accountId: string;
  finalText: string;
}

/** Per-account approve/reject with an optional edit of the final text (a learning signal). */
export function AgentAccountDecision({ runId, accountId, finalText }: AccountDecisionProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(finalText);
  const [comment, setComment] = useState("");

  async function decide(decision: Decision) {
    setBusy(true);
    const edited = decision === "APPROVED" && text.trim() !== finalText.trim() ? { editedText: text } : {};
    const { ok, message } = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: [accountId],
      decision,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...edited,
    });
    setBusy(false);
    if (!ok) return toast.error(message ?? "Decision failed");
    toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
    setComment("");
    router.refresh();
  }

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <Label htmlFor={`text-${accountId}`}>Final text (edit before approving if you want)</Label>
      <Textarea
        id={`text-${accountId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        maxLength={65000}
      />
      <Label htmlFor={`comment-${accountId}`}>Comment (optional)</Label>
      <Input
        id={`comment-${accountId}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="What worked, what did not"
        maxLength={2000}
      />
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => decide("APPROVED")} disabled={busy}>
          Approve
        </Button>
        <Button className="flex-1" variant="destructive" onClick={() => decide("REJECTED")} disabled={busy}>
          Reject
        </Button>
      </div>
      {text.trim() !== finalText.trim() && (
        <p className="text-xs text-muted-foreground">Your edit is saved with the approval and teaches the council.</p>
      )}
    </div>
  );
}
