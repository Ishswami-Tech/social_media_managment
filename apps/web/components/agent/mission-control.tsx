"use client";

/**
 * Mission control: the run as an operations room. The team graph on the left
 * (writers side by side, since they work at the same time), whoever is working
 * in the middle with its tools, its stated plan and its text as they arrive,
 * and on the right the running totals and what each agent handed to the next.
 * Solid dark panel, no glass. Framer Motion moves things; the packets on the
 * graph are plain CSS.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Award, Check, Sparkles, Wrench, X } from "lucide-react";
import {
  formatDuration,
  revealStages,
  stageOfStep,
  type AgentBoard,
  type AgentSeat,
  type ProgressStage,
  type ProgressStageKey,
  type TranscriptMessage,
} from "@platform/agent-council/progress";
import type { LivePartial } from "@platform/agent-council/live";
import { formatCents } from "@/components/agent/format";
import { AGENTS } from "@/components/agent/agents";
import { CountUp } from "@/components/ui/count-up";
import { cn } from "@/lib/utils";

const subscribeNever = (): (() => void) => () => {};
const PANEL = "rounded-xl bg-muted/60 p-3 dark:bg-muted/60 dark:bg-white/[0.04]";
const CAP = "text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground/80 dark:text-white/45";

export interface MissionControlProps {
  stages: ProgressStage[];
  board: AgentBoard;
  transcript: TranscriptMessage[];
  partials?: Record<string, LivePartial> | undefined;
  working: boolean;
  startedAt?: string | null | undefined;
  stats?: { facts?: number; drafts?: number; notesFixed?: number; spentCents?: number } | undefined;
  className?: string;
}

/** The clock only starts once the browser has it, so the markup matches the server's. */
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

function stageOfPartial(p: LivePartial): ProgressStageKey | null {
  return stageOfStep(p.step.split("#")[0] ?? p.step);
}

function Disc({ agent, size = "size-7", pulse, animate, dim }: { agent: ProgressStageKey; size?: string; pulse?: boolean; animate: boolean; dim?: boolean }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", size, dim && "opacity-40")}>
      {pulse && animate && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
          animate={{ scale: [1, 1.7], opacity: [0.55, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          aria-hidden
        />
      )}
      <span
        className="relative inline-flex size-full items-center justify-center rounded-full text-white"
        style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
        aria-hidden
      >
        <Icon className="size-[50%]" strokeWidth={1.8} />
      </span>
    </span>
  );
}

/** The agent as a member of staff: on duty, done, standing by. */
function Duty({ stage }: { stage: ProgressStage }) {
  if (stage.state === "active")
    return <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">On duty</span>;
  if (stage.state === "failed")
    return <span className="rounded-full bg-rose-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Stuck</span>;
  if (stage.state === "pending")
    return <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-white/10 dark:text-white/50">Standing by</span>;
  return null;
}

function Wire({ flowing, done, animate }: { flowing: boolean; done: boolean; animate: boolean }) {
  return (
    <span className={cn("relative ml-[13px] block h-3.5 w-0.5 overflow-hidden", done || flowing ? "bg-border dark:bg-white/25" : "bg-border/70 dark:bg-white/10")} aria-hidden>
      {flowing && animate && (
        <motion.span
          className="absolute left-0 top-0 h-1.5 w-0.5 bg-brand dark:bg-white"
          animate={{ y: [-6, 16] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
        />
      )}
    </span>
  );
}

function NodeCard({ stage, model, animate, children }: { stage: ProgressStage; model?: string; animate: boolean; children?: React.ReactNode }) {
  const identity = AGENTS[stage.key];
  const active = stage.state === "active";
  const done = stage.state === "done";
  const failed = stage.state === "failed";
  const pending = stage.state === "pending";
  return (
    <motion.div
      layout={animate}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5",
        active && "border-brand/50 dark:border-white/40 bg-brand/10 dark:bg-white/[0.07]",
        done && "border-emerald-500/40",
        failed && "border-rose-500/50",
        pending && "border-dashed border-border dark:border-white/15 opacity-45",
        stage.state === "skipped" && "border-border dark:border-white/15 opacity-60",
      )}
      style={active && animate ? { boxShadow: `0 0 0 3px ${identity.from}33` } : undefined}
    >
      <Disc agent={stage.key} pulse={active} animate={animate} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
          {identity.name}
          <Duty stage={stage} />
        </span>
        <span className="block truncate text-[10.5px] text-muted-foreground dark:text-white/55">{children ?? (pending ? identity.role : (stage.activity.at(-1) ?? identity.role))}</span>
        {model && !pending && <span className="block truncate text-[10px] text-muted-foreground/70 dark:text-white/40">{model}</span>}
      </span>
      {done && <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
      {failed && <X className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />}
    </motion.div>
  );
}

function WriterTile({ seat, animate }: { seat: AgentSeat; animate: boolean }) {
  const identity = AGENTS.drafting;
  const active = seat.state === "active";
  return (
    <motion.div
      layout={animate}
      className={cn(
        "grid min-w-0 justify-items-center gap-0.5 overflow-hidden rounded-lg border px-1 py-1.5 text-center",
        active && "border-brand/50 dark:border-white/40 bg-brand/10 dark:bg-white/[0.07]",
        seat.state === "done" && "border-emerald-500/40",
        seat.state === "failed" && "border-rose-500/50",
        seat.state === "pending" && "border-dashed border-border dark:border-white/15 opacity-45",
        seat.winner && "border-emerald-400",
      )}
      title={`${seat.name}${seat.modelLabel ? ` · ${seat.modelLabel}` : ""} · ${seat.detail}`}
    >
      <span className="relative">
        <Disc agent="drafting" size="size-6" pulse={active} animate={animate} />
        {seat.winner && <Award className="absolute -right-1.5 -top-1.5 size-3 text-emerald-600 dark:text-emerald-300" aria-hidden />}
      </span>
      <span className="text-[11px] font-medium" style={{ color: identity.to }}>
        {seat.label}
      </span>
      <span className="w-full max-w-full truncate text-[9.5px] text-muted-foreground dark:text-white/50">{seat.modelLabel ?? (seat.state === "pending" ? "waiting" : "…")}</span>
    </motion.div>
  );
}

function TeamGraph({ stages, board, animate }: { stages: ProgressStage[]; board: AgentBoard; animate: boolean }) {
  const activeIndex = stages.findIndex((s) => s.state === "active");
  return (
    <div className="min-w-0 overflow-hidden">
      <p className={cn(CAP, "mb-2")}>The team</p>
      <div className="grid grid-cols-[minmax(0,1fr)]">
        {stages.map((stage, i) => {
          const into = i > 0;
          const flowing = i === activeIndex;
          const doneWire = i > 0 && i <= activeIndex - 1;
          const isWriters = stage.key === "drafting" && board.writers.length > 0;
          return (
            <div key={stage.key} className="min-w-0">
              {into && <Wire flowing={flowing} done={doneWire || (activeIndex < 0 && stage.state !== "pending")} animate={animate} />}
              {isWriters ? (
                <div className={cn("min-w-0 rounded-lg", stage.state === "pending" && "opacity-45")}>
                  <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1">
                    {board.writers.map((w) => (
                      <WriterTile key={w.label} seat={w} animate={animate} />
                    ))}
                  </div>
                  <span className="mt-1 block text-center text-[10px] text-muted-foreground/80 dark:text-white/45">Quill · three writers, three models</span>
                </div>
              ) : (
                <NodeCard stage={stage} model={board.modelsByStage[stage.key]} animate={animate} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveWriter({ p, animate }: { p: LivePartial; animate: boolean }) {
  return (
    <motion.div
      layout={animate}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={animate ? { opacity: 0 } : undefined}
      className={PANEL}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <Disc agent="drafting" size="size-5" pulse animate={animate} />
        <span className="font-medium">Quill {p.label}</span>
        <span className="text-muted-foreground/80 dark:text-white/45">{p.model}</span>
        <span className="ml-auto tabular-nums text-muted-foreground/80 dark:text-white/45">{p.text.length} chars</span>
      </div>
      {p.note && (
        <p className="mb-1 border-l-2 border-border dark:border-white/30 pl-2 text-[12px] italic text-muted-foreground dark:text-white/70">
          {p.note}
        </p>
      )}
      <p className="max-h-28 overflow-hidden whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90 dark:text-white/90 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
        {p.text || (p.chars > 0 ? "Thinking…" : "Starting…")}
        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/80 dark:bg-white/80 align-middle" aria-hidden />
      </p>
    </motion.div>
  );
}

function Centre({ stages, board, partials, working, animate }: { stages: ProgressStage[]; board: AgentBoard; partials?: Record<string, LivePartial> | undefined; working: boolean; animate: boolean }) {
  const active = stages.find((s) => s.state === "active");
  const failed = stages.find((s) => s.state === "failed");
  const spot = active ?? failed ?? [...stages].reverse().find((s) => s.state !== "pending") ?? stages[0]!;
  const identity = AGENTS[spot.key];
  const all = Object.values(partials ?? {});
  const mine = all.filter((p) => stageOfPartial(p) === spot.key);
  const tools = mine.filter((p) => p.kind === "tool").sort((a, b) => a.step.localeCompare(b.step, undefined, { numeric: true })).slice(-4);
  const liveText = mine.filter((p) => p.kind !== "tool");
  const liveWriters = liveText.filter((p) => p.label).sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  const liveOther = liveText.find((p) => !p.label);
  const landed = spot.key === "drafting" ? board.writers.filter((w) => w.draft && !w.streaming) : [];
  const recent = spot.activity.slice(-3);

  return (
    <div className="grid min-w-0 content-start gap-2 overflow-hidden">
      <div className="flex min-w-0 items-center gap-3">
        <Disc agent={spot.key} size="size-10" pulse={working && spot.state === "active"} animate={animate} />
        <div className="min-w-0">
          <p className={CAP}>{working ? "Working now" : spot.state === "failed" ? "Stopped" : "Last on stage"}</p>
          <p className="truncate text-lg font-semibold leading-tight">
            {identity.name} <span className="text-sm font-normal text-muted-foreground dark:text-white/50">· {identity.role}</span>
          </p>
          <p className={cn("truncate text-[12px] text-muted-foreground dark:text-white/70", spot.state === "failed" && "text-rose-600 dark:text-rose-300")}>{spot.activity.at(-1) ?? spot.label}</p>
        </div>
        {board.modelsByStage[spot.key] && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border dark:border-white/15 px-2 py-0.5 text-[10px] text-muted-foreground dark:text-white/70">
            <Sparkles className="size-3" aria-hidden /> {board.modelsByStage[spot.key]}
          </span>
        )}
      </div>

      {tools.length > 0 && (
        <div>
          <p className={cn(CAP, "mb-1")}>Tools</p>
          <ul className="grid gap-1">
            <AnimatePresence initial={false}>
              {tools.map((t) => (
                <motion.li key={t.step} initial={animate ? { opacity: 0, x: -8 } : false} animate={{ opacity: 1, x: 0 }} exit={animate ? { opacity: 0 } : undefined} className="flex items-center gap-2 rounded-lg bg-muted/60 dark:bg-white/[0.04] px-2.5 py-1 text-[11.5px]">
                  <Wrench className="size-3 shrink-0 text-muted-foreground/80 dark:text-white/45" aria-hidden />
                  <span className="font-medium text-foreground/85 dark:text-white/85">{t.tool}</span>
                  {t.text && <span className="truncate italic text-muted-foreground dark:text-white/55">{t.text}</span>}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      <AnimatePresence initial={false}>
        {liveWriters.map((p) => (
          <LiveWriter key={p.step} p={p} animate={animate} />
        ))}
      </AnimatePresence>

      {liveOther && (
        <div className={PANEL}>
          <p className={cn(CAP, "mb-1")}>Thinking · {liveOther.text.length} chars</p>
          <p className="max-h-28 overflow-hidden whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90 dark:text-white/90 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
            {liveOther.text || (liveOther.chars > 0 ? "Thinking…" : "Starting…")}
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/80 dark:bg-white/80 align-middle" aria-hidden />
          </p>
        </div>
      )}

      {landed.length > 0 && (
        <div className="grid gap-1">
          <p className={CAP}>Landed</p>
          {landed.map((w) => (
            <p key={w.label} className="truncate rounded-lg bg-muted/60 dark:bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-foreground/75 dark:text-white/75">
              <span className="font-medium text-white">Quill {w.label}</span> · {w.draft}
            </p>
          ))}
        </div>
      )}

      {liveText.length === 0 && tools.length === 0 && landed.length === 0 && recent.length > 1 && (
        <ul className="grid gap-0.5 text-[12px] text-muted-foreground dark:text-white/55">
          {recent.slice(0, -1).map((line, i) => (
            <li key={`${line}-${i}`}>· {line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What each finished agent passed to the next: its last line, as a brief. */
function handoffs(stages: ProgressStage[]): { from: ProgressStageKey; to: ProgressStageKey; brief: string }[] {
  const out: { from: ProgressStageKey; to: ProgressStageKey; brief: string }[] = [];
  for (let i = 0; i < stages.length - 1; i += 1) {
    const from = stages[i]!;
    const to = stages[i + 1]!;
    if (from.state !== "done" && from.state !== "skipped") continue;
    out.push({ from: from.key, to: to.key, brief: from.activity.at(-1) ?? (from.state === "skipped" ? "skipped" : "done") });
  }
  return out.reverse();
}

export function MissionControl({ stages, board, transcript, partials, working, startedAt, stats, className }: MissionControlProps) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const animate = mounted && !reduced;
  const elapsedMs = useElapsed(startedAt, working);
  const next = useMemo(() => revealStages(stages).find((s) => s.hint)?.stage, [stages]);
  const briefs = useMemo(() => handoffs(stages), [stages]);
  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  const percent = Math.round((done / stages.length) * 100);
  const models = new Set(Object.values(board.modelsByStage)).size;
  const failedCalls = transcript.filter((m) => m.tone === "failed").length;

  return (
    <section
      aria-label="Mission control"
      className={cn("relative isolate overflow-hidden rounded-3xl border bg-card p-4 text-foreground dark:border-transparent dark:bg-[#0b0a14] dark:text-white sm:p-5", className)}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground dark:text-white/55">
        <span className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", working ? "animate-pulse bg-emerald-400" : "bg-white/40")} aria-hidden />
          {working ? "Live" : "Finished"}
          {elapsedMs !== null && <span className="tabular-nums text-foreground/80 dark:text-white/80">· {formatDuration(elapsedMs)}</span>}
        </span>
        <span className="flex items-center gap-3">
          {models > 0 && <span className="normal-case tracking-normal">{models} model{models === 1 ? "" : "s"} on this run</span>}
          <span className="tabular-nums">
            {done} / {stages.length}
          </span>
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_12rem]">
        <TeamGraph stages={stages} board={board} animate={animate} />
        <Centre stages={stages} board={board} partials={partials} working={working} animate={animate} />
        <div className="grid min-w-0 content-start gap-3 overflow-hidden md:col-span-2 xl:col-span-1">
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-2">
            {[
              { label: "Facts", value: stats?.facts ?? 0 },
              { label: "Drafts", value: stats?.drafts ?? 0 },
              { label: "Notes fixed", value: stats?.notesFixed ?? 0 },
              { label: "Failed calls", value: failedCalls },
            ].map((s) => (
              <div key={s.label} className={cn(PANEL, "min-w-0")}>
                <span className="block truncate text-[10px] text-muted-foreground/80 dark:text-white/45">{s.label}</span>
                <span className="block text-lg font-semibold tabular-nums">
                  <CountUp value={s.value} />
                </span>
              </div>
            ))}
            {(stats?.spentCents ?? 0) > 0 && (
              <div className={cn(PANEL, "col-span-2 md:col-span-4 xl:col-span-2")}>
                <span className="block text-[10px] text-muted-foreground/80 dark:text-white/45">Spend</span>
                <span className="block text-lg font-semibold tabular-nums">{formatCents(stats!.spentCents!)}</span>
              </div>
            )}
          </div>
          <div>
            <p className={cn(CAP, "mb-1")}>Handoffs</p>
            {briefs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/80 dark:text-white/45">None yet.</p>
            ) : (
              <ul className="grid min-w-0 gap-1">
                <AnimatePresence initial={false}>
                  {briefs.slice(0, 5).map((h) => (
                    <motion.li
                      key={`${h.from}-${h.to}`}
                      initial={animate ? { opacity: 0, x: 8 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex min-w-0 items-start gap-2 text-[11px]"
                    >
                      <Disc agent={h.from} size="size-4" animate={false} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1 font-medium">
                          {AGENTS[h.from].name} <ArrowRight className="size-3 text-muted-foreground/70 dark:text-white/40" aria-hidden /> {AGENTS[h.to].name}
                        </span>
                        <span className="block truncate text-muted-foreground dark:text-white/55">{h.brief}</span>
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
          {next && working && (
            <p className="text-[11px] text-muted-foreground dark:text-white/55">
              Next: <span className="font-medium text-foreground/85 dark:text-white/85">{AGENTS[next.key].name}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-border/70 dark:bg-white/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
    </section>
  );
}
