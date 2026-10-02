"use client";

/**
 * One conversation: what you asked for, what the AI did about it, and what it
 * came back with.
 *
 * The activity rows are driven by the same stage model the review screen uses,
 * so a line never reads one way here and another way there. Wording stays
 * plain: no run, no pipeline, no council.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { buildBoard, buildTranscript, shortReason, stageOfStep } from "@platform/agent-council/progress";
import { AGENTS } from "@/components/agent/agents";
import { CouncilRoom } from "@/components/agent/council-room";
import { applyPartials } from "@platform/agent-council/live";
import { CouncilBoard } from "@/components/agent/council-board";
import { SimpleProgress } from "@/components/agent/simple-progress";
import { useViewMode } from "@/hooks/use-view-mode";
import { cn } from "@/lib/utils";
import { useRunProgress, type RunInitial } from "@/components/agent/live-progress";
import { isProducing, isSettled } from "@/components/home/labels";
import { PlatformIcon } from "@/components/app/platform-icon";
import { PerformanceBadge, type PerformanceBadgeProps } from "@/components/agent/performance-badge";
import { MissionControl } from "@/components/agent/mission-control";
import { EditTools, type EditedAccount } from "@/components/agent/edit-tools";
import { Celebrate } from "@/components/agent/celebrate";
import { PostPreview } from "@/components/preview/post-preview";
import { CalendarClock, Check, Eye, Pause, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
    <article className="relative grid gap-3 rounded-2xl border border-border bg-card p-3 shadow-[0_18px_50px_-30px_rgba(80,60,200,0.35)] dark:border-border">
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
            <div className="grid gap-1 rounded-lg border border-border bg-card p-2 text-xs dark:border-border">
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
  const stageStats = useMemo(
    () => ({
      facts: snapshot.claimCount,
      drafts: board.writers.filter((w) => w.draft).length,
      notesFixed: transcript.reduce((sum, m) => sum + (m.output?.fixed ? (m.output.issues?.length ?? 0) : 0), 0),
      spentCents: snapshot.spentCents,
    }),
    [snapshot.claimCount, snapshot.spentCents, board.writers, transcript],
  );
  const { mode } = useViewMode();
  const detailed = mode === "detailed";
  const [showWork, setShowWork] = useState(false);
  const [showRoom, setShowRoom] = useState(false);
  // While the agents work the stage tells the story; the drafts side by side come after.
  const boardOpen = !working && showWork;
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
      <div className="grid gap-2 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-[17px] leading-snug font-semibold whitespace-pre-wrap">{topic}</p>
          {working && (
            <Link
              href={`/agent/${runId}/live`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-medium text-background hover:bg-foreground/85"
            >
              <span className="live-dot size-1.5 rounded-full bg-signal" aria-hidden /> Watch live
            </Link>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="flex -space-x-1">
            {chips.platforms.map((platform) => (
              <PlatformIcon key={platform} platform={platform} className="size-5 text-[8px] ring-2 ring-card" />
            ))}
          </span>
          <span className="truncate">{chips.names.join(", ")}</span>
          {skills.map((skill) => (
            <span key={skill} className="rounded-full bg-muted px-2 py-0.5">
              {skill}
            </span>
          ))}
          <span className="rounded-full bg-muted px-2 py-0.5">{model ?? "Auto model"}</span>
          <span className="rounded-full bg-muted px-2 py-0.5">{ASSURANCE_LABEL[assurance]}</span>
          {wantsImage && <span className="rounded-full bg-muted px-2 py-0.5">With image</span>}
        </p>
      </div>

      {/* What the AI did about it: plainly by default, with the machinery a click away. */}
      <div className="grid gap-3">
        {detailed ? (
          <MissionControl
            stages={progress.stages}
            board={board}
            transcript={transcript}
            partials={snapshot.partials}
            working={working}
            startedAt={initial.startedAt}
            stats={stageStats}
          />
        ) : (
          <SimpleProgress stages={progress.stages} working={working} startedAt={initial.startedAt} />
        )}
        {detailed && board.writers.length > 0 && (
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
        {detailed && (
          <button
            type="button"
            onClick={() => setShowRoom((v) => !v)}
            className="w-fit text-xs text-muted-foreground underline-offset-4 hover:underline"
            aria-expanded={showRoom}
          >
            {showRoom ? "Hide the conversation" : `Show the conversation (${transcript.length})`}
          </button>
        )}
        {detailed && showRoom && <CouncilRoom messages={transcript} stages={progress.stages} partials={snapshot.partials} working={working} />}

        {stopped && reason && (
          <p className="rounded-lg bg-warn-soft px-4 py-2.5 text-[13px] text-warn">{reason}</p>
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
          <Link href={`/agent/${runId}/live`} className={QUIET_ACTION}>
            {working ? "Watch the council" : "Replay the council"}
          </Link>
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

// ---------------------------------------------------------------------------
// Page-level Simple / Detailed switch
// ---------------------------------------------------------------------------

/** The Simple / Detailed segmented switch. Shared by every page that offers both views. */
export function ViewModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useViewMode();
  return (
    <div className={cn("inline-flex rounded-lg border border-border bg-card p-0.5 text-[13px]", className)} role="group" aria-label="How much detail to show">
      {(["simple", "detailed"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setMode(option)}
          aria-pressed={mode === option}
          className={cn(
            "rounded-md px-3 py-1 capitalize transition-colors",
            mode === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Renders its children only in the given view, so server-rendered sections can be shown or hidden by the switch. */
export function ViewOnly({ mode: only, children }: { mode: "simple" | "detailed"; children: React.ReactNode }) {
  const { mode } = useViewMode();
  return mode === only ? <>{children}</> : null;
}

// ---------------------------------------------------------------------------
// "Being written now": the compact live card on Today
// ---------------------------------------------------------------------------

/** The four steps a person cares about, folded from the seven seats. */
const SIMPLE_STEPS: { label: string; stages: string[] }[] = [
  { label: "Researching", stages: ["research", "strategy"] },
  { label: "Writing", stages: ["drafting"] },
  { label: "Checking", stages: ["review", "judge", "adapt"] },
  { label: "Ready for you", stages: ["ready"] },
];

const SEAT_ORDER = ["research", "strategy", "drafting", "review", "judge", "adapt", "ready"] as const;

const RUN_PILL: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "Starting", cls: "bg-muted text-muted-foreground" },
  RESEARCHING: { label: "Researching", cls: "bg-signal-soft text-signal-ink" },
  STRATEGIZING: { label: "Choosing angles", cls: "bg-signal-soft text-signal-ink" },
  DRAFTING: { label: "Writing", cls: "bg-signal-soft text-signal-ink" },
  REVIEWING: { label: "Checking", cls: "bg-signal-soft text-signal-ink" },
  JUDGING: { label: "Judging", cls: "bg-signal-soft text-signal-ink" },
  ADAPTING: { label: "Polishing", cls: "bg-signal-soft text-signal-ink" },
  PAUSED: { label: "Paused", cls: "bg-warn-soft text-warn" },
  BLOCKED: { label: "Needs you", cls: "bg-warn-soft text-warn" },
  AWAITING_APPROVAL: { label: "Ready for you", cls: "bg-success-soft text-success" },
};

export interface WritingNowProps {
  runId: string;
  topic: string;
  initial: RunInitial;
  /** "LinkedIn and Facebook". */
  platformsText: string;
  assurance: string;
  canManage: boolean;
  /** Typical start-to-ready time from recent runs, for the "about N minutes left" line. */
  typicalMs: number | null;
  /** Other campaigns waiting their turn. */
  queued: number;
  /** Nothing is being written: show the most recent run so the council is always on the page. */
  recent?: boolean;
}

function minutesLeft(typicalMs: number | null, startedAt: string | null, now: number): string {
  if (!typicalMs || !startedAt || !now) return "Usually ready in a few minutes.";
  const left = typicalMs - (now - Date.parse(startedAt));
  if (left <= 60_000) return "Almost there.";
  const mins = Math.round(left / 60_000);
  return `About ${mins} minute${mins === 1 ? "" : "s"} left.`;
}

const subscribeMinute = (cb: () => void) => {
  const id = window.setInterval(cb, 15_000);
  return () => window.clearInterval(id);
};
const nowMinute = () => Math.floor(Date.now() / 15_000) * 15_000;
const nowServer = () => 0;

export function WritingNowCard({ runId, topic, initial, platformsText, assurance, canManage, typicalMs, queued, recent = false }: WritingNowProps) {
  const router = useRouter();
  const { snapshot, progress } = useRunProgress(runId, initial, () => router.refresh());
  const { mode } = useViewMode();
  const [busy, setBusy] = useState(false);
  const now = useSyncExternalStore(subscribeMinute, nowMinute, nowServer);
  const board = useMemo(() => buildBoard(snapshot.status, snapshot.events, snapshot.accounts), [snapshot]);
  const status = snapshot.status;
  const pill = RUN_PILL[status] ?? { label: status.toLowerCase(), cls: "bg-muted text-muted-foreground" };
  const stageState = (key: string) => progress.stages.find((s) => s.key === key)?.state ?? "pending";
  const startedText = initial.startedAt ? `started ${Math.max(1, Math.round(((now || Date.parse(initial.startedAt)) - Date.parse(initial.startedAt)) / 60_000))} min ago` : "starting";

  async function act(action: "pause" | "cancel" | "resume") {
    setBusy(true);
    const r = await post(`/api/agent/runs/${runId}/${action}`);
    setBusy(false);
    if (!r.ok) return toast.error(r.message ?? "That did not work. Try again.");
    toast.success(action === "pause" ? "Paused" : action === "cancel" ? "Cancelled" : "Back on it");
    router.refresh();
  }

  const seats = SEAT_ORDER.map((key) => {
    const identity = AGENTS[key];
    const state = stageState(key);
    let note: string = state === "done" ? "Done" : state === "active" ? "Working" : state === "failed" ? "Stopped" : "Waiting";
    if (key === "research" && state === "done" && snapshot.claimCount > 0) note = `Done · ${snapshot.claimCount} facts`;
    if (key === "drafting") {
      const total = board.writers.length || 3;
      const done = board.writers.filter((w) => w.state === "done").length;
      note = state === "done" ? `Done · ${total} drafts` : state === "active" ? `Writing · ${done} of ${total}` : note;
    }
    if (key === "ready") note = "Approve";
    return { key, name: key === "drafting" ? "Quill ×3" : identity.name, note, state };
  });

  const log = [...snapshot.events]
    .filter((e) => e.status !== "STARTED")
    .slice(-5)
    .map((e) => {
      const stage = stageOfStep(e.step);
      const label = e.step.split(":")[2]?.split(".")[0];
      const who = stage ? `${AGENTS[stage].name}${stage === "drafting" && label ? ` ${label}` : ""}` : e.step;
      const what = [e.provider && e.model ? `${e.provider.toLowerCase()}::${e.model}` : null, e.latencyMs ? `${(e.latencyMs / 1000).toFixed(1)} s` : null, e.error ? shortReason(e.error) : null]
        .filter(Boolean)
        .join(" · ");
      return { id: e.id, at: new Date(e.at).toLocaleTimeString("en-GB"), who, what: what || e.status.toLowerCase() };
    });

  return (
    <section aria-labelledby="writing-h" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="writing-h" className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">
          {recent ? "The council · latest run" : "Being written now"}
        </h2>
        {queued > 0 && <span className="text-[13px] text-muted-foreground">{queued} more queued</span>}
      </div>
      <article className="flex flex-col gap-[18px] rounded-[14px] border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12.5px] font-semibold", pill.cls)}>
                {!recent && <span className="live-dot size-1.5 rounded-full bg-current" aria-hidden />}
                {pill.label}
              </span>
              <span className="text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                For {platformsText} · {recent ? "last run" : startedText} · {ASSURANCE_LABEL[assurance as keyof typeof ASSURANCE_LABEL] ?? assurance}
              </span>
            </div>
            <h3 className="font-display text-[18px] font-bold">{topic}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <Link href={`/agent/${runId}/live`}>
                <Eye aria-hidden /> {recent ? "Open the council room" : "Watch the council live"}
              </Link>
            </Button>
            {canManage && !recent && status !== "PAUSED" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("pause")}>
                <Pause aria-hidden /> Pause
              </Button>
            )}
            {canManage && status === "PAUSED" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("resume")}>
                Carry on
              </Button>
            )}
            {canManage && !recent && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("cancel")}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        {mode !== "detailed" ? (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap gap-2.5">
              {SIMPLE_STEPS.map((step, i) => {
                const states = step.stages.map(stageState);
                const done = states.every((s) => s === "done");
                const live = !done && states.some((s) => s === "active");
                return (
                  <div key={step.label} className="flex min-w-[120px] flex-1 items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex size-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[12px] text-white dark:text-[#14161a]",
                        done ? "bg-foreground" : live ? "bg-signal" : "bg-[#C4C8C1] dark:bg-white/20",
                      )}
                    >
                      {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
                    </span>
                    <span className={cn("text-[13.5px]", done || live ? "font-semibold" : "text-muted-foreground")}>{step.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E6E8E3] dark:bg-white/10">
              <div className="h-full rounded-full bg-signal transition-[width] duration-500" style={{ width: `${progress.overall.percent}%` }} />
            </div>
            <span className="text-[13px] text-[#454B53] dark:text-muted-foreground" suppressHydrationWarning>
              {minutesLeft(typicalMs, initial.startedAt, now)} We’ll put it in “Waiting on you” when it’s ready — you can leave this page.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start overflow-x-auto px-0.5 py-1">
              {seats.map((seat, i) => (
                <div key={seat.key} className="contents">
                  <div className="flex min-w-[72px] flex-1 flex-col items-center gap-2 text-center">
                    <span
                      className={cn("inline-flex rounded-full", seat.state === "pending" && "opacity-40")}
                      style={seat.state === "active" ? { boxShadow: "0 0 0 4px var(--signal-soft)" } : undefined}
                    >
                      <span
                        className="inline-flex size-[34px] items-center justify-center rounded-full font-display text-[14px] font-bold text-white dark:text-[#111316]"
                        style={{ background: AGENTS[seat.key].from }}
                      >
                        {AGENTS[seat.key].name.charAt(0)}
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold">{seat.name}</span>
                    <span
                      className={cn(
                        "text-[12px]",
                        seat.state === "active" ? "text-signal" : seat.state === "done" ? "text-success" : seat.state === "failed" ? "text-danger" : "text-[#6B717A]",
                      )}
                    >
                      {seat.note}
                    </span>
                  </div>
                  {i < seats.length - 1 && (
                    <div aria-hidden className={cn("mt-4 h-0.5 flex-[0_1_24px]", seat.state === "done" ? "bg-foreground" : "bg-[#D5D8D2] dark:bg-white/15")} />
                  )}
                </div>
              ))}
            </div>
            {log.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#F6F7F4] px-4 py-3.5 font-mono text-[12.5px] dark:bg-white/[0.04]">
                {log.map((l) => (
                  <div key={l.id} className="flex gap-3.5">
                    <span className="text-[#6B717A]" suppressHydrationWarning>{l.at}</span>
                    <span className="min-w-[64px] font-semibold">{l.who}</span>
                    <span className="truncate text-[#3F454D] dark:text-muted-foreground">{l.what}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="font-mono text-[12px] text-muted-foreground">
                run {runId.slice(0, 7)}… · ${(snapshot.spentCents / 100).toFixed(2)} spent of ${(snapshot.maxCents / 100).toFixed(2)}
              </span>
              <div className="flex-[1_1_160px]">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E6E8E3] dark:bg-white/10">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${snapshot.maxCents ? Math.min(100, (snapshot.spentCents / snapshot.maxCents) * 100) : 0}%` }} />
                </div>
              </div>
              <Link href={`/agent/${runId}/live`} className="text-[13px] underline underline-offset-2">
                Open replay
              </Link>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
