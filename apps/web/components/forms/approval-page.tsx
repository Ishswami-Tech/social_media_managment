"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ApprovalAccount {
  id: string;
  platform: string;
  displayName: string;
  finalText: string | null;
  finalHashtags: string[];
  mediaConcept: string | null;
  decision: string;
}

interface Props {
  token: string;
  run: { topic: string; goal: string; status: string; organizationName: string };
  accounts: ApprovalAccount[];
}

interface ApproveResponse {
  run?: { id: string; status: string };
  message?: string;
}

type Outcome = { kind: "APPROVED" | "REJECTED"; status: string } | { kind: "ERROR"; message: string };

const MAX_ACCOUNTS = 10;

export function ApprovalPage({ token, run, accounts }: Props) {
  const pending = accounts.filter((a) => a.decision === "PENDING");
  const [selected, setSelected] = useState<string[]>(pending.slice(0, MAX_ACCOUNTS).map((a) => a.id));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    const res = await fetch("/api/agent/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        decision,
        accountIds: selected,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as ApproveResponse;
    setBusy(false);
    if (!res.ok || !data.run) {
      const message = data.message ?? "Could not record your decision";
      setOutcome({ kind: "ERROR", message });
      toast.error(message);
      return;
    }
    setOutcome({ kind: decision, status: data.run.status });
    toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
  }

  if (outcome && outcome.kind !== "ERROR") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{outcome.kind === "APPROVED" ? "Approved" : "Rejected"}</CardTitle>
          <CardDescription>
            Thanks — your decision was recorded. The campaign is now {outcome.status.replaceAll("_", " ").toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This approval link has been used and cannot be used again.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{run.topic}</CardTitle>
        <CardDescription>
          {run.organizationName} · {run.goal} · <StatusBadge status={run.status} />
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {outcome?.kind === "ERROR" && <p className="text-sm text-destructive">{outcome.message}</p>}
        {pending.length === 0 && (
          <p className="text-sm text-muted-foreground">Every account in this campaign has already been decided.</p>
        )}
        {accounts.map((a) => {
          const decidable = a.decision === "PENDING";
          return (
            <div key={a.id} className="grid gap-2 rounded-md border p-3">
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox
                  checked={selected.includes(a.id)}
                  onCheckedChange={() => toggle(a.id)}
                  disabled={!decidable}
                />
                <PlatformIcon platform={a.platform} />
                <span className="flex-1 truncate font-medium">{a.displayName}</span>
                <StatusBadge status={a.decision} />
              </label>
              {a.finalText ? (
                <p className="text-sm whitespace-pre-wrap">{a.finalText}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No recommendation text yet.</p>
              )}
              {a.finalHashtags.length > 0 && (
                <p className="text-sm text-muted-foreground">{a.finalHashtags.map((h) => `#${h}`).join(" ")}</p>
              )}
              {a.mediaConcept && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Media concept: </span>
                  {a.mediaConcept}
                </p>
              )}
            </div>
          );
        })}
        {pending.length > 0 && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="approval-comment">Comment (optional)</Label>
              <Input
                id="approval-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Anything the team should know"
                maxLength={2000}
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => decide("APPROVED")} disabled={busy || selected.length === 0}>
                Approve selected ({selected.length})
              </Button>
              <Button
                className="flex-1"
                variant="destructive"
                onClick={() => decide("REJECTED")}
                disabled={busy || selected.length === 0}
              >
                Reject selected
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This link is personal and can only be used once. Nothing is published until you approve.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
