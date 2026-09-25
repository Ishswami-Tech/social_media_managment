"use client";

/**
 * Watching the AI work, live.
 *
 * `useRunProgress` tails the campaign's Server-Sent Events stream and, if that
 * connection keeps failing, quietly falls back to polling the run endpoint.
 * `LiveProgress` renders what it finds: a vertical stepper on the review screen
 * and a single line of chips on the home screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Compass,
  Loader2,
  MinusCircle,
  PenLine,
  Scale,
  Search,
  ShieldCheck,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  buildProgress,
  formatDuration,
  type ProgressAccount,
  type ProgressEvent,
  type ProgressStage,
  type ProgressStageKey,
  type RunProgress,
  progressOutput,
} from "@platform/agent-council/progress";
import type { LivePartial } from "@platform/agent-council/live";
import { formatCents } from "@/components/agent/format";
import { isSettled } from "@/components/home/labels";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** What the stream's `snapshot` message carries. */
export interface RunSnapshot {
  status: string;
  currentStep: string | null;
  spentCents: number;
  maxCents: number;
  claimCount: number;
  accounts: ProgressAccount[];
  events: ProgressEvent[];
  /** Text still arriving from in-flight model calls, by step. Only the stream delivers these. */
  partials?: Record<string, LivePartial>;
}

/** The server-rendered starting point, plus when the work began. */
export interface RunInitial extends RunSnapshot {
  startedAt: string | null;
}

/** The stream's `status` message. */
interface StatusMessage {
  status: string;
  currentStep: string | null;
  spentCents: number;
  maxCents: number;
  claimCount: number;
}

/** The slice of `GET /api/agent/runs/[id]` the polling fallback reads. */
interface RunPollPayload {
  run?: {
    status: string;
    currentStep: string | null;
    spentCents: number;
    maxCents: number;
    accounts: {
      id: string;
      platform: string;
      decision: string;
      finalText: string | null;
      editedText: string | null;
      socialAccount: { displayName: string };
    }[];
    events: {
      id: string;
      step: string;
      status: string;
      provider: string | null;
      model: string | null;
      costCents: number;
      latencyMs: number;
      error: string | null;
      createdAt: string;
      output?: unknown;
    }[];
    claims: unknown[];
  };
}

const POLL_FALLBACK_MS = 5_000;
/** Two failures in a row means the stream is not going to work here. */
const MAX_STREAM_ERRORS = 2;
/** Plenty for the view; keeps a long campaign from growing without bound. */
const MAX_EVENTS = 400;

function fromPoll(run: NonNullable<RunPollPayload["run"]>): RunSnapshot {
  return {
    status: run.status,
    currentStep: run.currentStep,
    spentCents: run.spentCents,
    maxCents: run.maxCents,
    claimCount: run.claims.length,
    accounts: run.accounts.map((a) => ({
      runAccountId: a.id,
      displayName: a.socialAccount.displayName,
      platform: a.platform,
      decision: a.decision,
      hasRecommendation: Boolean(a.editedText ?? a.finalText),
    })),
    events: run.events.slice(-MAX_EVENTS).map((e) => {
      const output = progressOutput(e.step, e.output);
      return {
        id: e.id,
        step: e.step,
        status: e.status,
        provider: e.provider,
        model: e.model,
        costCents: e.costCents,
        latencyMs: e.latencyMs,
        error: e.error,
        at: e.createdAt,
        ...(output ? { output } : {}),
      };
    }),
  };
}

function mergeEvent(events: ProgressEvent[], incoming: ProgressEvent): ProgressEvent[] {
  if (events.some((e) => e.id === incoming.id)) return events;
  const next = [...events, incoming];
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

/** A finished step's stored event replaces whatever partial text was showing for it. */
function withoutPartial(
  partials: Record<string, LivePartial> | undefined,
  event: ProgressEvent,
): Record<string, LivePartial> | undefined {
  if (!partials || event.status === "STARTED" || !(event.step in partials)) return partials;
  const { [event.step]: _dropped, ...rest } = partials;
  return rest;
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRunProgress {
  snapshot: RunSnapshot;
  progress: RunProgress;
  /** True while the live stream is delivering; false on the polling fallback. */
  live: boolean;
  /** Re-open the stream after the run was retried or resumed (it closes on settled statuses). */
  reconnect: () => void;
}

/**
 * Keeps a campaign snapshot up to date. Prefers the event stream; after two
 * failures it polls instead, so a proxy that eats SSE only costs freshness.
 */
export function useRunProgress(runId: string, initial: RunInitial, onReady?: () => void): UseRunProgress {
  const [snapshot, setSnapshot] = useState<RunSnapshot>(initial);
  const [live, setLive] = useState(true);
  const [generation, setGeneration] = useState(0);
  const readyFired = useRef(false);
  const reconnect = useCallback(() => {
    readyFired.current = false;
    setSnapshot((s) => ({ ...s, status: "QUEUED" }));
    setGeneration((g) => g + 1);
  }, []);
  const onReadyRef = useRef(onReady);
  // Kept in a ref so an inline callback does not restart the stream on every
  // render. Written after paint, never during it.
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  const announce = useCallback((status: string) => {
    if (readyFired.current || !isSettled(status)) return;
    readyFired.current = true;
    onReadyRef.current?.();
  }, []);

  // The run may already be finished when the page renders.
  useEffect(() => {
    announce(initial.status);
  }, [announce, initial.status]);

  useEffect(() => {
    if (isSettled(snapshot.status)) return;
    let stopped = false;
    let source: EventSource | null = null;
    let pollTimer: number | undefined;
    let retryTimer: number | undefined;
    let errors = 0;

    const stop = () => {
      stopped = true;
      source?.close();
      source = null;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/agent/runs/${runId}`, { headers: { accept: "application/json" } });
        // Signed out, or no longer ours: asking again will not help.
        if (res.status === 401 || res.status === 403 || res.status === 404) return stop();
        const body = (await res.json().catch(() => ({}))) as RunPollPayload;
        if (res.ok && body.run) {
          const next = fromPoll(body.run);
          setSnapshot(next);
          announce(next.status);
          if (isSettled(next.status)) return stop();
        }
      } catch {
        // Offline or a blip; try again on the next tick.
      }
      if (!stopped) pollTimer = window.setTimeout(() => void poll(), POLL_FALLBACK_MS);
    };

    const fallback = () => {
      if (stopped) return;
      source?.close();
      source = null;
      setLive(false);
      void poll();
    };

    const connect = () => {
      if (stopped) return;
      const es = new EventSource(`/api/agent/runs/${runId}/stream`);
      source = es;

      es.addEventListener("open", () => {
        errors = 0;
        setLive(true);
      });

      es.addEventListener("snapshot", (e) => {
        const data = parse<RunSnapshot>((e as MessageEvent<string>).data);
        if (!data) return;
        setSnapshot(data);
        announce(data.status);
        // The campaign finished between the page render and this connection;
        // the server closes straight away, so stop before retrying forever.
        if (isSettled(data.status)) stop();
      });

      es.addEventListener("event", (e) => {
        const data = parse<ProgressEvent>((e as MessageEvent<string>).data);
        if (!data) return;
        setSnapshot((cur) => ({ ...cur, events: mergeEvent(cur.events, data), partials: withoutPartial(cur.partials, data) }));
      });

      es.addEventListener("partial", (e) => {
        const data = parse<LivePartial>((e as MessageEvent<string>).data);
        if (!data) return;
        setSnapshot((cur) => ({ ...cur, partials: { ...cur.partials, [data.step]: data } }));
      });

      es.addEventListener("status", (e) => {
        const data = parse<StatusMessage>((e as MessageEvent<string>).data);
        if (!data) return;
        setSnapshot((cur) => ({ ...cur, ...data }));
        announce(data.status);
        if (isSettled(data.status)) stop();
      });

      es.addEventListener("error", () => {
        if (stopped) return;
        // The browser retries on its own, but only for a while: after two
        // failures we stop trusting the stream and poll instead.
        errors += 1;
        es.close();
        source = null;
        if (errors >= MAX_STREAM_ERRORS) return fallback();
        setLive(false);
        retryTimer = window.setTimeout(connect, 1_000 * errors);
      });
    };

    if (typeof window !== "undefined" && "EventSource" in window) connect();
    else fallback();

    return stop;
    // `snapshot.status` only matters for the settled check, which stops the
    // effect for good; re-running on every event would reconnect constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, announce, generation]);

  const progress = useMemo(
    () => buildProgress(snapshot.status, snapshot.events, snapshot.accounts, { claimCount: snapshot.claimCount }),
    [snapshot],
  );

  return { snapshot, progress, live, reconnect };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const STAGE_ICONS: Record<ProgressStageKey, typeof Search> = {
  research: Search,
  strategy: Compass,
  drafting: PenLine,
  review: ShieldCheck,
  judge: Scale,
  adapt: Wand2,
  ready: CheckCircle2,
};

const SHORT_LABELS: Record<ProgressStageKey, string> = {
  research: "Research",
  strategy: "Angle",
  drafting: "Drafts",
  review: "Checks",
  judge: "Judge",
  adapt: "Adapt",
  ready: "Ready",
};

function StageIcon({ stage, className }: { stage: ProgressStage; className?: string }) {
  if (stage.state === "active") return <Loader2 className={cn("size-4 animate-spin text-primary", className)} aria-hidden />;
  if (stage.state === "done") return <CheckCircle2 className={cn("size-4 text-emerald-600", className)} aria-hidden />;
  if (stage.state === "failed") return <XCircle className={cn("size-4 text-destructive", className)} aria-hidden />;
  if (stage.state === "skipped") return <MinusCircle className={cn("size-4 text-muted-foreground", className)} aria-hidden />;
  const Icon = STAGE_ICONS[stage.key];
  return <Icon className={cn("size-4 text-muted-foreground/60", className)} aria-hidden />;
}

/** The clock only starts once the browser has it, so the markup matches the server's. */
function useElapsed(startedAt: string | null, running: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Reading the clock while rendering would disagree with the server's
    // markup, so the first reading lands just after the browser takes over.
    const first = window.setTimeout(tick, 0);
    const repeat = running ? window.setInterval(tick, 1_000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (repeat !== undefined) window.clearInterval(repeat);
    };
  }, [running]);
  if (now === null || !startedAt) return null;
  const parsed = Date.parse(startedAt);
  return Number.isNaN(parsed) ? null : Math.max(0, now - parsed);
}

function Activity({ lines, label }: { lines: string[]; label: string }) {
  const recent = lines.slice(-4);
  if (recent.length === 0) return null;
  return (
    <ul aria-live="polite" aria-label={`What is happening: ${label}`} className="mt-1 grid gap-0.5">
      {recent.map((line, i) => (
        <li
          key={`${line}-${i}`}
          className={cn(
            "text-xs text-muted-foreground",
            i === recent.length - 1 && line.endsWith("…") && "animate-pulse text-foreground/80",
          )}
        >
          {line}
        </li>
      ))}
    </ul>
  );
}

function Meta({
  elapsedMs,
  spentCents,
  maxCents,
  percent,
}: {
  elapsedMs: number | null;
  spentCents: number;
  /** Shown alongside the spend so the budget is never a surprise. */
  maxCents?: number;
  percent: number;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span>{percent}%</span>
      {elapsedMs !== null && <span>· {formatDuration(elapsedMs)}</span>}
      {spentCents > 0 && (
        <span>
          · {formatCents(spentCents)}
          {maxCents ? ` of ${formatCents(maxCents)}` : ""}
        </span>
      )}
    </span>
  );
}

interface Props {
  runId: string;
  initial: RunInitial;
  variant?: "full" | "compact";
  /**
   * Called once, when the campaign stops needing the live view. Both screens
   * that use this are Server Components and cannot hand a function across the
   * boundary, so the default is what they both want: re-render the page so the
   * finished result takes the place of the flow.
   */
  onReady?: () => void;
  className?: string;
}

export function LiveProgress({ runId, initial, variant = "full", onReady, className }: Props) {
  const router = useRouter();
  const handleReady = useCallback(() => {
    if (onReady) onReady();
    else router.refresh();
  }, [onReady, router]);
  const { snapshot, progress } = useRunProgress(runId, initial, handleReady);
  const running = !isSettled(snapshot.status);
  const elapsedMs = useElapsed(initial.startedAt, running);
  const active = progress.stages.find((s) => s.state === "active");
  const failed = progress.stages.find((s) => s.state === "failed");

  if (variant === "compact") {
    return (
      <div className={cn("grid gap-2", className)}>
        <ol className="flex flex-wrap items-center gap-1.5">
          {progress.stages.map((stage) => (
            <li
              key={stage.key}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                stage.state === "active" && "border-primary/40 bg-primary/5 text-foreground",
                stage.state === "done" && "text-muted-foreground",
                stage.state === "failed" && "border-destructive/40 text-destructive",
                (stage.state === "pending" || stage.state === "skipped") && "text-muted-foreground/60",
              )}
              title={stage.label}
            >
              <StageIcon stage={stage} className="size-3" />
              <span>{SHORT_LABELS[stage.key]}</span>
            </li>
          ))}
        </ol>
        <Progress value={progress.overall.percent} className="h-1" aria-label="Progress" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            aria-live="polite"
            className={cn("min-w-0 truncate text-xs", failed ? "text-destructive" : "text-muted-foreground")}
          >
            {failed?.activity.at(-1) ?? active?.activity.at(-1) ?? progress.overall.label}
          </p>
          <Meta elapsedMs={elapsedMs} spentCents={snapshot.spentCents} percent={progress.overall.percent} />
        </div>
      </div>
    );
  }

  return (
    <section className={cn("grid gap-3 rounded-lg border p-4", className)} aria-label="What the AI is doing">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          {running && <Loader2 className="size-4 animate-spin text-primary" aria-hidden />}
          {progress.overall.label}
        </h2>
        <Meta
          elapsedMs={elapsedMs}
          spentCents={snapshot.spentCents}
          maxCents={snapshot.maxCents}
          percent={progress.overall.percent}
        />
      </header>

      <Progress value={progress.overall.percent} className="h-1" aria-label="Progress" />

      <ol className="grid">
        {progress.stages.map((stage, index) => {
          const last = index === progress.stages.length - 1;
          return (
            <li key={stage.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="flex size-6 items-center justify-center">
                  <StageIcon stage={stage} />
                </span>
                {!last && (
                  <span
                    className={cn(
                      "w-px flex-1",
                      stage.state === "done" ? "bg-emerald-600/30" : "bg-border",
                    )}
                    aria-hidden
                  />
                )}
              </div>
              <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-4")}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={cn(
                      "text-sm",
                      stage.state === "active" && "font-medium",
                      stage.state === "failed" && "font-medium text-destructive",
                      (stage.state === "pending" || stage.state === "skipped") && "text-muted-foreground",
                    )}
                  >
                    {stage.label}
                  </span>
                  {stage.state === "done" && stage.durationMs !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(stage.durationMs)}
                    </span>
                  )}
                  {stage.state === "skipped" && <span className="text-xs text-muted-foreground">skipped</span>}
                  {stage.costCents > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">{formatCents(stage.costCents)}</span>
                  )}
                </div>
                {(stage.state === "active" || stage.state === "failed") && (
                  <Activity lines={stage.activity} label={stage.label} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
