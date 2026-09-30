"use client";

/**
 * The run for someone who does not want to know how it works.
 *
 * Mission control answers "which model, which seat, which tool". This answers
 * only "is it working, how far along, and is anything wrong". No models, no
 * providers, no councils, no tool calls, no costs: the same seven stages
 * written the way a person would describe them.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { formatDuration, type ProgressStage, type ProgressStageKey } from "@platform/agent-council/progress";
import { cn } from "@/lib/utils";

const subscribeNever = (): (() => void) => () => {};

/** What each stage is doing, in the words someone would use who does not work here. */
const PLAIN: Record<ProgressStageKey, { doing: string; done: string }> = {
  research: { doing: "Reading up on your topic", done: "Read up on your topic" },
  strategy: { doing: "Deciding what angle to take", done: "Chose an angle" },
  drafting: { doing: "Writing a few versions", done: "Wrote a few versions" },
  review: { doing: "Checking the facts and the wording", done: "Checked the facts and the wording" },
  judge: { doing: "Picking the best one", done: "Picked the best one" },
  adapt: { doing: "Polishing it for the platform", done: "Polished it" },
  ready: { doing: "Waiting for you", done: "Ready for you" },
};

export interface SimpleProgressProps {
  stages: ProgressStage[];
  working: boolean;
  startedAt?: string | null | undefined;
  className?: string;
}

/** Elapsed time, started only in the browser so the markup matches the server's. */
function useElapsed(startedAt: string | null | undefined, running: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const repeat = running ? window.setInterval(tick, 1000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (repeat !== undefined) window.clearInterval(repeat);
    };
  }, [running]);
  if (now === null || !startedAt) return null;
  const parsed = Date.parse(startedAt);
  return Number.isNaN(parsed) ? null : Math.max(0, now - parsed);
}

export function SimpleProgress({ stages, working, startedAt, className }: SimpleProgressProps) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const animate = mounted && !reduced;
  const elapsedMs = useElapsed(startedAt, working);

  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  const percent = Math.round((done / stages.length) * 100);
  const active = stages.find((s) => s.state === "active");
  const failed = stages.find((s) => s.state === "failed");
  const headline = failed
    ? "Something went wrong"
    : active
      ? PLAIN[active.key].doing
      : working
        ? "Getting started"
        : "Your post is ready";

  return (
    <section aria-label="Progress" className={cn("rounded-2xl border bg-card p-4 text-foreground sm:p-5 dark:bg-[#0b0a14] dark:text-white", className)}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-medium">
          {working && !failed && <Loader2 className="size-4 animate-spin text-brand" aria-hidden />}
          {failed && <AlertTriangle className="size-4 text-rose-500" aria-hidden />}
          {headline}
        </h2>
        <p className="text-xs text-muted-foreground dark:text-white/55">
          {/* Elapsed only while it runs: once finished this is time since it started, which
              counts any night the run sat waiting and tells a reader nothing useful. */}
          {working ? `Step ${Math.min(done + 1, stages.length)} of ${stages.length}${elapsedMs !== null ? ` · ${formatDuration(elapsedMs)}` : ""}` : "Finished"}
        </p>
      </header>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted dark:bg-white/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
          animate={{ width: `${Math.max(percent, working ? 4 : 0)}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      <ol className="grid gap-1.5">
        {stages.map((stage) => {
          const isDone = stage.state === "done" || stage.state === "skipped";
          const isActive = stage.state === "active";
          const isFailed = stage.state === "failed";
          return (
            <li key={stage.key} className={cn("flex items-center gap-2.5 text-sm", !isDone && !isActive && !isFailed && "text-muted-foreground/60 dark:text-white/35")}>
              <span
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  isDone && "border-emerald-500 bg-emerald-500 text-white",
                  isActive && "border-brand text-brand",
                  isFailed && "border-rose-500 bg-rose-500 text-white",
                )}
                aria-hidden
              >
                {isDone && <Check className="size-3" />}
                {isActive && <Loader2 className="size-3 animate-spin" />}
                {isFailed && <AlertTriangle className="size-3" />}
              </span>
              <span className={cn(isActive && "font-medium")}>{isDone ? PLAIN[stage.key].done : PLAIN[stage.key].doing}</span>
            </li>
          );
        })}
      </ol>

      <AnimatePresence initial={false}>
        {active && active.activity.length > 0 && (
          <motion.p
            key={active.activity.at(-1)}
            initial={animate ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={animate ? { opacity: 0 } : undefined}
            className="mt-3 truncate text-xs text-muted-foreground dark:text-white/55"
          >
            {active.activity.at(-1)}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}
