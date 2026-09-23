"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface ReviewSource {
  id: string;
  title: string;
  url: string | null;
}

export interface ReviewAccount {
  /** AgentRunAccount id. */
  id: string;
  platform: string;
  displayName: string;
  /** Final text with hashtags, ready to edit. Empty while the text is still being written. */
  text: string;
  /** One line explaining the angle that was chosen. */
  why: string | null;
  /** Generated image attached to the recommendation, when there is one. */
  image: { url: string; alt: string } | null;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  decisionComment: string | null;
  postId: string | null;
  error: string | null;
}

interface Props {
  runId: string;
  status: string;
  accounts: ReviewAccount[];
  sources: ReviewSource[];
  unverifiedCount: number;
  /** `content:approve`, the text is awaiting a decision, and it is not the viewer's own. */
  canDecide: boolean;
  /** `content:create` — pause, stop and try again. */
  canManage: boolean;
  /**
   * Render only Pause/Resume/Stop/Try again, without the per-account texts.
   * The review screen uses this while the AI is still working, so those
   * controls are reachable before there is anything to read.
   */
  controlsOnly?: boolean;
}

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

/** States the worker can still be asked to stop. */
const STOPPABLE = new Set([
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

const QUIET_ACTION = "text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50";

function Sources({ sources, unverifiedCount }: { sources: ReviewSource[]; unverifiedCount: number }) {
  if (sources.length === 0 && unverifiedCount === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">Sources: </span>
      {sources.length === 0 ? (
        <span>none yet</span>
      ) : (
        sources.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ", "}
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </span>
        ))
      )}
      {unverifiedCount > 0 && <span> · {unverifiedCount} point(s) we could not verify</span>}
    </p>
  );
}

function AccountBlock({
  runId,
  account,
  sources,
  unverifiedCount,
  canDecide,
}: {
  runId: string;
  account: ReviewAccount;
  sources: ReviewSource[];
  unverifiedCount: number;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(account.text);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(true);
    const edited = decision === "APPROVED" && text.trim() !== account.text.trim() ? { editedText: text } : {};
    const { ok, message } = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: [account.id],
      decision,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...edited,
    });
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "That did not work. Try again.");
      return;
    }
    toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
    setComment("");
    router.refresh();
  }

  return (
    <article className="grid gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <PlatformIcon platform={account.platform} />
        <span className="text-sm font-medium">{account.displayName}</span>
        {account.decision !== "PENDING" && (
          <span className="text-xs text-muted-foreground">
            {account.decision === "APPROVED" ? "Approved" : "Rejected"}
          </span>
        )}
        {account.postId && (
          <Link href={`/posts/${account.postId}`} className="text-xs underline underline-offset-4">
            Published as post
          </Link>
        )}
      </header>

      {account.text ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          maxLength={65000}
          aria-label={`Post text for ${account.displayName}`}
          readOnly={!canDecide}
          className="text-base"
        />
      ) : (
        <p className="text-sm text-muted-foreground">The text is still being written.</p>
      )}

      {account.image && (
        <a href={account.image.url} target="_blank" rel="noreferrer" className="block w-fit" title="Open the image">
          {/* eslint-disable-next-line @next/next/no-img-element -- storage URLs are signed and short-lived */}
          <img src={account.image.url} alt={account.image.alt} className="max-h-64 rounded-md border object-cover" />
        </a>
      )}

      {account.why && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Why this post: </span>
          {account.why}
        </p>
      )}
      <Sources sources={sources} unverifiedCount={unverifiedCount} />

      {account.error && <p className="text-xs text-destructive">{account.error}</p>}
      {account.decisionComment && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Your note: </span>
          {account.decisionComment}
        </p>
      )}

      {canDecide && account.text && (
        <div className="grid gap-2">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note (optional)"
            maxLength={2000}
            aria-label={`Note for ${account.displayName}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => decide("APPROVED")}>
              Approve
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => decide("REJECTED")}>
              Reject
            </Button>
          </div>
          {text.trim() !== account.text.trim() && (
            <p className="text-xs text-muted-foreground">Your edit is saved with the approval.</p>
          )}
        </div>
      )}
    </article>
  );
}

export function ReviewPanel({
  runId,
  status,
  accounts,
  sources,
  unverifiedCount,
  canDecide,
  canManage,
  controlsOnly = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: string, message: string) {
    setBusy(true);
    const result = await post(`/api/agent/runs/${runId}/${action}`);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "That did not work. Try again.");
      return;
    }
    toast.success(message);
    router.refresh();
  }

  const canPause = canManage && STOPPABLE.has(status);
  const canResume = canManage && (status === "PAUSED" || status === "BLOCKED");
  const canStop = canManage && (STOPPABLE.has(status) || status === "PAUSED" || status === "BLOCKED");
  const canRetry = canManage && status === "FAILED";

  return (
    <div className="grid gap-4">
      {!controlsOnly && accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">No accounts were picked for this one.</p>
      )}
      {!controlsOnly &&
        accounts.map((a) => (
          <AccountBlock
            key={a.id}
            runId={runId}
            account={a}
            sources={sources}
            unverifiedCount={unverifiedCount}
            canDecide={canDecide && a.decision === "PENDING"}
          />
        ))}

      {(canPause || canResume || canStop || canRetry) && (
        <div className="flex flex-wrap gap-4 text-sm">
          {canPause && (
            <button type="button" disabled={busy} onClick={() => act("pause", "Paused")} className={QUIET_ACTION}>
              Pause
            </button>
          )}
          {canResume && (
            <button type="button" disabled={busy} onClick={() => act("resume", "Resumed")} className={QUIET_ACTION}>
              Resume
            </button>
          )}
          {canRetry && (
            <button type="button" disabled={busy} onClick={() => act("retry", "Trying again")} className={QUIET_ACTION}>
              Try again
            </button>
          )}
          {canStop && (
            <button type="button" disabled={busy} onClick={() => act("cancel", "Stopped")} className={QUIET_ACTION}>
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}
