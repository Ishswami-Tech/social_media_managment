"use client";

/**
 * One conversation: what you asked for, what the AI did about it, and what it
 * came back with.
 *
 * The activity rows are driven by the same stage model the review screen uses,
 * so a line never reads one way here and another way there. Wording stays
 * plain: no run, no pipeline, no council.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { buildBoard, buildTranscript, formatDuration, type ProgressStage } from "@platform/agent-council/progress";
import { CouncilRoom } from "@/components/agent/council-room";
import { applyPartials } from "@platform/agent-council/live";
import { CouncilBoard } from "@/components/agent/council-board";
import { formatCents } from "@/components/agent/format";
import { useRunProgress, type RunInitial } from "@/components/agent/live-progress";
import { isProducing, isSettled } from "@/components/home/labels";
import { PlatformIcon } from "@/components/app/platform-icon";
import { PerformanceBadge, type PerformanceBadgeProps } from "@/components/agent/performance-badge";
import { CouncilFlow } from "@/components/agent/council-flow";
import { EditTools, type EditedAccount } from "@/components/agent/edit-tools";
import { Celebrate } from "@/components/agent/celebrate";
import { motion } from "framer-motion";
import { PostPreview } from "@/components/preview/post-preview";
import { CalendarClock, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ThreadDecision = "PENDING" | "APPROVED" | "REJECTED";

export interface PostResults {
  publishedAt: string | null;
  externalUrl: string | null;
  impressions?: number;
  likes?: number;
  comments?: number;
  capturedAt: string | null;
}

export interface ThreadAccount {
  /** AgentRunAccount id — what the decide route expects. */
  id: string;
  platform: string;
  displayName: string;
  avatarUrl: string | null;
  /** Posting windows that have worked for this account, e.g. "tue morning (UTC)". */
  bestWindows: string[];
  /** Live numbers once the post is out (latest analytics snapshot), or null. */
  results: PostResults | null;
  /** Final text with hashtags; empty while it is still being written. */
  text: string;
  /** One line explaining the angle that was chosen. */
  why: string | null;
  /** Generated image attached to the recommendation, when there is one. */
  image: { url: string; alt: string } | null;
  /** Expected-reach estimate once the text is final. */
  performance: PerformanceBadgeProps | null;
  decision: ThreadDecision;
  postId: string | null;
}

export interface ThreadProps {
  runId: string;
  topic: string;
  /** Server-rendered starting point for the live view. */
  initial: RunInitial;
  accounts: ThreadAccount[];
  /** Names of the skills that were attached. */
  skills: string[];
  /** Short model name, or null when it was picked automatically. */
  model: string | null;
  assurance: "JUDGE_ONLY" | "HIGH_ASSURANCE";
  /** An image is generated for every post. */
  wantsImage: boolean;
  blockedReason: string | null;
  error: string | null;
  /** `content:approve`, and it is not the viewer's own request. */
  canDecide: boolean;
  /** `content:create` — pause, stop and try again. */
  canManage: boolean;
}

interface ErrorBody {
  message?: string;
}

/** The slice of `GET /api/agent/runs/[id]` this view reads while publishing. */
interface RunPollPayload {
  run?: {
    status: string;
    accounts: { id: string; decision: string; postId: string | null }[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_MS = 5_000;
const QUIET_ACTION = "text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50";

async function post(path: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as ErrorBody;
    return { ok: res.ok, message: data.message };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

function isDecision(value: string): value is ThreadDecision {
  return value === "PENDING" || value === "APPROVED" || value === "REJECTED";
}

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------

function ResultCard({
  runId,
  account,
  runStatus,
  canDecide,
  onDecided,
}: {
  runId: string;
  account: ThreadAccount;
  runStatus: string;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const [text, setText] = useState(account.text);
  const [savedText, setSavedText] = useState(account.text);
  const [performance, setPerformance] = useState(account.performance);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [celebration, setCelebration] = useState(0);
  // After a refresh (judge override, another person's edit) the server's text wins.
  const [seen, setSeen] = useState(account.text);
  if (seen !== account.text) {
    setSeen(account.text);
    setText(account.text);
    setSavedText(account.text);
    setPerformance(account.performance);
  }

  function applyEdit(edited: EditedAccount) {
    setText(edited.text);
    setSavedText(edited.text);
    setPerformance(edited.performance);
  }

  async function decide(decision: ThreadDecision) {
    if (decision === "PENDING") return;
    setBusy(true);
    const edited = decision === "APPROVED" && text.trim() !== savedText.trim() ? { editedText: text } : {};
    const when = decision === "APPROVED" && scheduling && publishAt ? { publishAt: new Date(publishAt).toISOString() } : {};
    const { ok, message } = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: [account.id],
      decision,
      ...(note.trim() ? { comment: note.trim() } : {}),
      ...edited,
      ...when,
    });
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "That did not work. Try again.");
      return;
    }
    toast.success(decision === "APPROVED" ? (scheduling && publishAt ? "Approved and scheduled" : "Approved") : "Rejected");
    if (decision === "APPROVED") setCelebration((n) => n + 1);
    setRejecting(false);
    setScheduling(false);
    setNote("");
    onDecided();
  }

  const decided = account.decision !== "PENDING";
  const published = Boolean(account.postId);

  return (
    <article className="relative grid gap-3 rounded-2xl border border-white/60 bg-white/60 p-3 shadow-[0_18px_50px_-30px_rgba(80,60,200,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
      <Celebrate token={celebration} />
      <header className="flex flex-wrap items-center gap-2">
        <PlatformIcon platform={account.platform} />
        <span className="text-sm font-medium">{account.displayName}</span>
        {account.decision === "REJECTED" && <span className="text-xs text-muted-foreground">Rejected</span>}
        {account.decision === "APPROVED" &&
          (published ? (
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>Published</span>
              {account.results?.impressions !== undefined && <span className="font-medium text-foreground">{account.results.impressions.toLocaleString()} views</span>}
              {account.results?.likes !== undefined && <span>{account.results.likes} reactions</span>}
              {account.results?.comments !== undefined && <span>{account.results.comments} comments</span>}
              {account.results?.externalUrl && (
                <a href={account.results.externalUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  Open on {account.platform.toLowerCase() === "linkedin" ? "LinkedIn" : "platform"}
                </a>
              )}
              <Link href={`/posts/${account.postId}`} className="underline underline-offset-4">
                Details
              </Link>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {runStatus === "FAILED" || runStatus === "CANCELLED" ? (
                "Could not publish"
              ) : (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Publishing…
                </>
              )}
            </span>
          ))}
      </header>

      {account.text ? (
        <div className="grid gap-2">
          {editing ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              maxLength={65000}
              readOnly={!canDecide || decided}
              aria-label={`Post text for ${account.displayName}`}
              className="text-sm"
            />
          ) : (
            <PostPreview
              platform={account.platform}
              account={{ displayName: account.displayName, avatarUrl: account.avatarUrl }}
              text={text}
              media={account.image ? [{ id: "image", url: account.image.url, alt: account.image.alt }] : []}
            />
          )}
          {canDecide && !decided && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {editing ? <Eye className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
              {editing ? "Preview" : "Edit text"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The text is still being written.</p>
      )}

      {performance && <PerformanceBadge {...performance} />}

      {!decided && canDecide && account.text && runStatus === "AWAITING_APPROVAL" && (
        <EditTools runId={runId} accountId={account.id} text={text} savedText={savedText} disabled={busy} onUpdated={applyEdit} />
      )}

      {account.why && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Why: </span>
          {account.why}
        </p>
      )}

      {!decided && canDecide && account.text && runStatus === "AWAITING_APPROVAL" && (
        <div className="grid gap-2">
          {rejecting && (
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why not? (optional)"
              maxLength={2000}
              aria-label={`Note for ${account.displayName}`}
              autoFocus
            />
          )}
          {scheduling && (
            <div className="grid gap-1 rounded-lg border border-white/60 bg-white/50 p-2 text-xs backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
              <label className="grid gap-1">
                <span className="text-muted-foreground">Publish at (your local time)</span>
                <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className="h-8 w-56 text-xs" />
              </label>
              {account.bestWindows.length > 0 && (
                <p className="text-muted-foreground">
                  Has worked for this account: <span className="text-foreground">{account.bestWindows.join(", ")}</span>
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || (scheduling && !publishAt)} onClick={() => void decide("APPROVED")}>
              {scheduling ? "Approve for that time" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setScheduling((v) => !v)}
              title={scheduling ? "Publish right away instead" : "Pick when it goes out"}
            >
              <CalendarClock aria-hidden /> {scheduling ? "Publish now" : "Pick a time"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => (rejecting ? void decide("REJECTED") : setRejecting(true))}
            >
              {rejecting ? "Confirm reject" : "Reject"}
            </Button>
            {rejecting && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
      {!decided && !canDecide && account.text && (
        <p className="text-xs text-muted-foreground">Someone else on your team needs to look at this one.</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

const ASSURANCE_LABEL: Record<ThreadProps["assurance"], string> = {
  JUDGE_ONLY: "Judge only",
  HIGH_ASSURANCE: "High assurance",
};

export function Thread({
  runId,
  topic,
  initial,
  accounts,
  skills,
  model,
  assurance,
  wantsImage,
  blockedReason,
  error,
  canDecide,
  canManage,
}: ThreadProps) {
  const router = useRouter();
  // When the work finishes while this is on screen, the server has the post
  // and the images: ask it to render them. A thread that arrived already
  // finished has nothing new to fetch.
  const startedLive = useRef(!isSettled(initial.status));
  const onReady = useCallback(() => {
    if (startedLive.current) router.refresh();
  }, [router]);
  const { snapshot, progress, reconnect } = useRunProgress(runId, initial, onReady);
  const [rows, setRows] = useState<ThreadAccount[]>(accounts);
  const [busy, setBusy] = useState(false);

  // A page refresh brings fresher rows than the ones polling left behind, so
  // the server's version wins whenever it actually changed.
  const fromServer = accounts.map((a) => `${a.id}:${a.decision}:${a.postId ?? ""}:${a.text.length}`).join("|");
  const [seen, setSeen] = useState(fromServer);
  if (seen !== fromServer) {
    setSeen(fromServer);
    setRows(accounts);
  }

  const status = snapshot.status;
  const working = !isSettled(status) || status === "APPROVED";
  const board = useMemo(
    () => applyPartials(buildBoard(snapshot.status, snapshot.events, snapshot.accounts), snapshot.partials),
    [snapshot],
  );
  const transcript = useMemo(
    () => buildTranscript(snapshot.events, snapshot.accounts, { claimCount: snapshot.claimCount }),
    [snapshot],
  );
  const [showWork, setShowWork] = useState(false);
  const [selectedStage, setSelectedStage] = useState<ProgressStage["key"] | null>(null);
  const selectedDetail = selectedStage ? progress.stages.find((s) => s.key === selectedStage) : undefined;
  const boardOpen = working || showWork;
  const ready = rows.some((a) => a.text) && !isProducing(status);

  // After an approval the post is created in the background, so we keep asking
  // until every approved account has one.
  const awaitingPublish = rows.some((a) => a.decision === "APPROVED" && !a.postId);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (!awaitingPublish && status !== "APPROVED" && status !== "PUBLISHING") return;
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/agent/runs/${runId}`, { headers: { accept: "application/json" } });
        if (res.status === 401 || res.status === 403 || res.status === 404) return;
        const body = (await res.json().catch(() => ({}))) as RunPollPayload;
        const run = body.run;
        if (res.ok && run) {
          setRows((cur) =>
            cur.map((row) => {
              const live = run.accounts.find((a) => a.id === row.id);
              if (!live) return row;
              const decision = isDecision(live.decision) ? live.decision : row.decision;
              if (decision === row.decision && live.postId === row.postId) return row;
              return { ...row, decision, postId: live.postId };
            }),
          );
          // Once the run has stopped, nothing else is coming: stop asking.
          if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") return;
        }
      } catch {
        // Offline or a blip; ask again on the next tick.
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), POLL_MS);
    };

    timer = window.setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [runId, status, awaitingPublish]);

  async function act(action: string, message: string) {
    setBusy(true);
    const result = await post(`/api/agent/runs/${runId}/${action}`);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "That did not work. Try again.");
      return;
    }
    toast.success(message);
    if (action === "retry" || action === "resume") {
      startedLive.current = true;
      reconnect();
    }
    refresh();
  }

  const chips = useMemo(() => {
    const platforms = [...new Set(accounts.map((a) => a.platform))];
    return { platforms, names: accounts.map((a) => a.displayName) };
  }, [accounts]);

  const stopped = status === "BLOCKED" || status === "FAILED" || status === "CANCELLED";
  const reason =
    status === "BLOCKED"
      ? (blockedReason ?? "I stopped to check with you.")
      : status === "FAILED"
        ? (error ?? "Something went wrong.")
        : null;

  return (
    <section className="grid gap-3" aria-label={topic}>
      {/* What you asked for. */}
      <div className="flex justify-end">
        <div className="grid max-w-[85%] gap-1.5 rounded-2xl rounded-br-sm bg-gradient-to-br from-brand to-brand-2 px-3.5 py-2.5 text-white shadow-[0_12px_30px_-14px_color-mix(in_oklch,var(--brand)_70%,transparent)]">
          <p className="text-sm whitespace-pre-wrap">{topic}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/80">
            <span className="flex -space-x-1">
              {chips.platforms.map((platform) => (
                <PlatformIcon key={platform} platform={platform} className="size-4 text-[8px] ring-2 ring-background" />
              ))}
            </span>
            <span className="truncate">{chips.names.join(", ")}</span>
            {skills.map((skill) => (
              <span key={skill} className="rounded-full border px-1.5">
                {skill}
              </span>
            ))}
            <span className="rounded-full border px-1.5">{model ?? "Auto"}</span>
            <span className="rounded-full border px-1.5">{ASSURANCE_LABEL[assurance]}</span>
            {wantsImage && <span className="rounded-full border px-1.5">With image</span>}
          </p>
        </div>
      </div>

      {/* What the AI did about it: the council at a glance, then the detail. */}
      <div className="grid max-w-[95%] gap-2">
        <CouncilFlow
          stages={progress.stages}
          working={working}
          models={board.modelsByStage}
          selected={selectedStage}
          onSelect={(key) => setSelectedStage((cur) => (cur === key ? null : key))}
        />
        {selectedDetail && (
          <div className="grid gap-1 rounded-xl border border-brand/30 bg-brand/5 p-3 text-sm backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{selectedDetail.label}</span>
              <span className="text-xs text-muted-foreground">
                {board.modelsByStage[selectedDetail.key] ? `${board.modelsByStage[selectedDetail.key]} · ` : ""}
                {selectedDetail.durationMs ? formatDuration(selectedDetail.durationMs) : selectedDetail.state}
                {selectedDetail.costCents > 0 ? ` · ${formatCents(selectedDetail.costCents)}` : ""}
              </span>
            </div>
            {selectedDetail.activity.length > 0 ? (
              <ol className="grid gap-0.5 text-xs text-muted-foreground">
                {selectedDetail.activity.map((line, i) => (
                  <li key={`${i}-${line}`}>{line}</li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing yet.</p>
            )}
          </div>
        )}
        <div className="grid gap-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className={cn(working && "animate-pulse")}>{progress.overall.label}</span>
            <span>{progress.overall.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
              animate={{ width: `${progress.overall.percent}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>
        {board.writers.length > 0 && (
          <div className="grid gap-2">
            {!working && (
              <button
                type="button"
                onClick={() => setShowWork((v) => !v)}
                className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
                aria-expanded={boardOpen}
              >
                {boardOpen ? "Hide the writers' work" : `Show the writers' work (${board.writers.length} drafts)`}
              </button>
            )}
            {boardOpen && <CouncilBoard board={board} working={working} />}
          </div>
        )}
        <CouncilRoom messages={transcript} stages={progress.stages} partials={snapshot.partials} working={working} />

        {stopped && reason && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">{reason}</p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          {canManage && working && !stopped && status !== "AWAITING_APPROVAL" && (
            <>
              <button type="button" className={QUIET_ACTION} disabled={busy} onClick={() => void act("pause", "Paused")}>
                Pause
              </button>
              <button type="button" className={QUIET_ACTION} disabled={busy} onClick={() => void act("cancel", "Stopped")}>
                Stop
              </button>
            </>
          )}
          {canManage && status === "PAUSED" && (
            <button type="button" className={QUIET_ACTION} disabled={busy} onClick={() => void act("resume", "Back on it")}>
              Carry on
            </button>
          )}
          {canManage && (status === "FAILED" || status === "BLOCKED") && (
            <button
              type="button"
              className={QUIET_ACTION}
              disabled={busy}
              onClick={() => void act(status === "FAILED" ? "retry" : "resume", "Trying again")}
            >
              Try again
            </button>
          )}
          <Link href={`/review/${runId}`} className={QUIET_ACTION}>
            How this was made
          </Link>
        </div>

        {ready && (
          <div className="grid gap-2">
            {rows.map((account) => (
              <ResultCard
                key={account.id}
                runId={runId}
                account={account}
                runStatus={status}
                canDecide={canDecide}
                onDecided={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
