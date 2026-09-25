"use client";

/**
 * Mission control: the run as an operations room, two columns. Left, the team
 * as a graph: the writers side by side because they work at the same time, and
 * whoever is working opens up in place to show its tools, its stated plan and
 * its text as they arrive. Right, the running totals and what each agent
 * handed to the next. Solid surfaces in both themes, no glass. Framer Motion
 * moves the agents; GSAP sweeps a light across the room on each handoff.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
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
const PANEL = "rounded-xl bg-muted/60 p-3 dark:bg-white/[0.04]";
const CAP = "text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-white/45";
const MUTED = "text-muted-foreground dark:text-white/55";
const BODY = "text-foreground/90 dark:text-white/90";

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

/** "Claude Fable 5.1" → "Fable 5.1": the vendor is obvious from the colour, the variant is what matters here. */
function shortModel(label: string | undefined): string | undefined {
  return label?.replace(/^(Claude|OpenAI|Google)\s+/i, "");
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

/** Five bars that dance while the team works, still when it rests. */
function Signal({ working, animate }: { working: boolean; animate: boolean }) {
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className={cn("w-[3px] rounded-sm", working ? "bg-emerald-500 dark:bg-emerald-400" : "bg-muted-foreground/40 dark:bg-white/30")}
          animate={working && animate ? { height: ["30%", "100%", "45%", "85%", "30%"] } : { height: "35%" }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }}
        />
      ))}
    </span>
  );
}

function Disc({ agent, size = "size-7", pulse, animate }: { agent: ProgressStageKey; size?: string; pulse?: boolean; animate: boolean }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", size)}>
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
function Duty({ state }: { state: ProgressStage["state"] }) {
  const base = "rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide";
  if (state === "active") return <span className={cn(base, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>On duty</span>;
  if (state === "failed") return <span className={cn(base, "bg-rose-500/15 text-rose-700 dark:text-rose-300")}>Stuck</span>;
  if (state === "pending") return <span className={cn(base, "bg-muted text-muted-foreground dark:bg-white/10 dark:text-white/50")}>Standing by</span>;
  return null;
}

function Wire({ flowing, done, animate }: { flowing: boolean; done: boolean; animate: boolean }) {
  return (
    <span className={cn("relative ml-[13px] block h-3.5 w-0.5 overflow-hidden", done || flowing ? "bg-border dark:bg-white/25" : "bg-border/70 dark:bg-white/10")} aria-hidden>
      {flowing && animate && (
        <motion.span className="absolute left-0 top-0 h-1.5 w-0.5 bg-brand dark:bg-white" animate={{ y: [-6, 16] }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} />
      )}
    </span>
  );
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/80 align-middle dark:bg-white/80" aria-hidden />;
}

/** What one live model call looks like on stage: the plan, then the text arriving. */
function LiveText({ p, animate, label }: { p: LivePartial; animate: boolean; label: string }) {
  return (
    <motion.div layout={animate} initial={animate ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} exit={animate ? { opacity: 0 } : undefined} className={PANEL}>
      <div className={cn("mb-1 flex items-center gap-2 text-[11px]", MUTED)}>
        <span className="font-medium text-foreground dark:text-white">{label}</span>
        {p.model && <span>{shortModel(p.model)}</span>}
        <span className="ml-auto tabular-nums">{p.text.length} chars</span>
      </div>
      {p.note && <p className={cn("mb-1 border-l-2 border-brand/50 pl-2 text-[12px] italic", MUTED)}>{p.note}</p>}
      <p className={cn("max-h-28 overflow-hidden whitespace-pre-wrap text-[13px] leading-relaxed [mask-image:linear-gradient(to_bottom,black_70%,transparent)]", BODY)}>
        {p.text || (p.chars > 0 ? "Thinking…" : "Starting…")}
        <Cursor />
      </p>
    </motion.div>
  );
}

/** Everything live for one agent: its tool calls and its answer so far. */
function LiveBlock({ stage, partials, animate }: { stage: ProgressStage; partials: LivePartial[]; animate: boolean }) {
  const tools = partials.filter((p) => p.kind === "tool").sort((a, b) => a.step.localeCompare(b.step, undefined, { numeric: true })).slice(-4);
  const texts = partials.filter((p) => p.kind !== "tool").sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  const recent = stage.activity.slice(-3, -1);
  if (tools.length === 0 && texts.length === 0 && recent.length === 0) return null;
  return (
    <motion.div layout={animate} initial={animate ? { opacity: 0, height: 0 } : false} animate={{ opacity: 1, height: "auto" }} className="ml-9 grid gap-1.5 overflow-hidden pt-1.5">
      {tools.length > 0 && (
        <ul className="grid gap-1">
          <AnimatePresence initial={false}>
            {tools.map((t) => (
              <motion.li key={t.step} initial={animate ? { opacity: 0, x: -8 } : false} animate={{ opacity: 1, x: 0 }} exit={animate ? { opacity: 0 } : undefined} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1 text-[11.5px] dark:bg-white/[0.04]">
                <Wrench className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">{t.tool}</span>
                {t.text && <span className={cn("truncate italic", MUTED)}>{t.text}</span>}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <AnimatePresence initial={false}>
        {texts.map((p) => (
          <LiveText key={p.step} p={p} animate={animate} label={p.label ? `Quill ${p.label}` : AGENTS[stage.key].name} />
        ))}
      </AnimatePresence>
      {texts.length === 0 && tools.length === 0 && recent.length > 0 && (
        <ul className={cn("grid gap-0.5 text-[11.5px]", MUTED)}>
          {recent.map((line, i) => (
            <li key={`${line}-${i}`}>· {line}</li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function NodeCard({ stage, model, animate }: { stage: ProgressStage; model?: string; animate: boolean }) {
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
        active && "border-brand/50 bg-brand/10 dark:border-white/40 dark:bg-white/[0.07]",
        done && "border-emerald-500/40",
        failed && "border-rose-500/50",
        pending && "border-dashed opacity-45",
        stage.state === "skipped" && "opacity-60",
      )}
      style={active && animate ? { boxShadow: `0 0 0 3px ${identity.from}33` } : undefined}
    >
      <Disc agent={stage.key} pulse={active} animate={animate} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
          {identity.name}
          <Duty state={stage.state} />
        </span>
        <span className={cn("block truncate text-[10.5px]", MUTED, failed && "text-rose-600 dark:text-rose-300")}>{pending ? identity.role : (stage.activity.at(-1) ?? identity.role)}</span>
        {model && !pending && (
          <span className="block truncate text-[10px] text-muted-foreground/70 dark:text-white/40">
            <Sparkles className="mr-1 inline size-2.5" aria-hidden />
            {shortModel(model)}
          </span>
        )}
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
        active && "border-brand/50 bg-brand/10 dark:border-white/40 dark:bg-white/[0.07]",
        seat.state === "done" && "border-emerald-500/40",
        seat.state === "failed" && "border-rose-500/50",
        seat.state === "pending" && "border-dashed opacity-45",
        seat.winner && "border-emerald-500",
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
      <span className={cn("w-full max-w-full break-words text-[9.5px] leading-tight", MUTED)}>{shortModel(seat.modelLabel) ?? (seat.state === "pending" ? "waiting" : "…")}</span>
    </motion.div>
  );
}

function TeamGraph({ stages, board, partials, animate }: { stages: ProgressStage[]; board: AgentBoard; partials: LivePartial[]; animate: boolean }) {
  const activeIndex = stages.findIndex((s) => s.state === "active");
  const landed = board.writers.filter((w) => w.draft && !w.streaming);
  return (
    <div className="min-w-0 overflow-hidden">
      <p className={cn(CAP, "mb-2")}>The team</p>
      <div className="grid grid-cols-[minmax(0,1fr)]">
        {stages.map((stage, i) => {
          const flowing = i === activeIndex;
          const doneWire = i > 0 && i <= activeIndex - 1;
          const isWriters = stage.key === "drafting" && board.writers.length > 0;
          const mine = partials.filter((p) => stageOfPartial(p) === stage.key);
          const open = stage.state === "active" || stage.state === "failed";
          return (
            <motion.div key={stage.key} className="min-w-0" initial={animate ? { opacity: 0, x: -10 } : false} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.35 }}>
              {i > 0 && <Wire flowing={flowing} done={doneWire || (activeIndex < 0 && stage.state !== "pending")} animate={animate} />}
              {isWriters ? (
                <div className={cn("min-w-0 rounded-lg", stage.state === "pending" && "opacity-45")}>
                  <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1">
                    {board.writers.map((w) => (
                      <WriterTile key={w.label} seat={w} animate={animate} />
                    ))}
                  </div>
                  <span className={cn("mt-1 block text-center text-[10px]", MUTED)}>Quill · three writers, three models, at the same time</span>
                  {stage.state === "active" && <LiveBlock stage={stage} partials={mine} animate={animate} />}
                  {stage.state === "active" && landed.length > 0 && (
                    <div className="ml-9 mt-1.5 grid gap-1">
                      {landed.map((w) => (
                        <p key={w.label} className={cn("truncate rounded-lg bg-muted/60 px-2.5 py-1.5 text-[12px] dark:bg-white/[0.04]", MUTED)}>
                          <span className="font-medium text-foreground dark:text-white">Quill {w.label} landed</span> · {w.draft}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <NodeCard stage={stage} model={board.modelsByStage[stage.key]} animate={animate} />
                  {open && stage.key !== "ready" && <LiveBlock stage={stage} partials={mine} animate={animate} />}
                </>
              )}
            </motion.div>
          );
        })}
      </div>
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
  const live = useMemo(() => Object.values(partials ?? {}), [partials]);
  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  const percent = Math.round((done / stages.length) * 100);
  const models = new Set([...Object.values(board.modelsByStage), ...board.writers.flatMap((w) => (w.modelLabel ? [w.modelLabel] : []))]).size;
  const failedCalls = transcript.filter((m) => m.tone === "failed").length;
  const activeKey = stages.find((s) => s.state === "active")?.key ?? null;
  const room = useRef<HTMLElement>(null);

  // GSAP: a handoff sends a light sweep across the room.
  useEffect(() => {
    const root = room.current;
    if (!root || !animate || !activeKey) return;
    const sweep = root.querySelector<HTMLElement>("[data-sweep]");
    if (!sweep) return;
    const tween = gsap.fromTo(sweep, { xPercent: -130, opacity: 0.5 }, { xPercent: 130, opacity: 0, duration: 1.1, ease: "power2.inOut" });
    return () => {
      tween.kill();
    };
  }, [activeKey, animate]);

  return (
    <section
      ref={room}
      aria-label="Mission control"
      className={cn("relative isolate overflow-hidden rounded-3xl border bg-card p-4 text-foreground sm:p-5 dark:border-transparent dark:bg-[#0b0a14] dark:text-white", className)}
    >
      <div data-sweep aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-brand/20 to-transparent opacity-0 dark:via-white/20" />

      <header className={cn("mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em]", MUTED)}>
        <span className="flex items-center gap-2">
          <Signal working={working} animate={animate} />
          {working ? "Live" : "Finished"}
          {elapsedMs !== null && <span className="tabular-nums text-foreground/80 dark:text-white/80">· {formatDuration(elapsedMs)}</span>}
        </span>
        <span className="flex items-center gap-3">
          {models > 0 && (
            <span className="normal-case tracking-normal">
              {models} model{models === 1 ? "" : "s"} on this run
            </span>
          )}
          <span className="tabular-nums">
            {done} / {stages.length}
          </span>
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <TeamGraph stages={stages} board={board} partials={live} animate={animate} />

        <div className="grid min-w-0 content-start gap-3 overflow-hidden">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: "Facts", value: stats?.facts ?? 0 },
              { label: "Drafts", value: stats?.drafts ?? 0 },
              { label: "Notes fixed", value: stats?.notesFixed ?? 0 },
              { label: "Failed calls", value: failedCalls },
            ].map((s) => (
              <div key={s.label} className={cn(PANEL, "min-w-0")}>
                <span className={cn("block truncate text-[10px]", MUTED)}>{s.label}</span>
                <span className="block text-lg font-semibold tabular-nums">
                  <CountUp value={s.value} />
                </span>
              </div>
            ))}
            {(stats?.spentCents ?? 0) > 0 && (
              <div className={cn(PANEL, "col-span-2")}>
                <span className={cn("block text-[10px]", MUTED)}>Spend</span>
                <span className="block text-lg font-semibold tabular-nums">{formatCents(stats!.spentCents!)}</span>
              </div>
            )}
          </div>

          <div>
            <p className={cn(CAP, "mb-1")}>Handoffs</p>
            {briefs.length === 0 ? (
              <p className={cn("text-[11px]", MUTED)}>None yet.</p>
            ) : (
              <ul className="grid min-w-0 gap-1">
                <AnimatePresence initial={false}>
                  {briefs.slice(0, 5).map((h) => (
                    <motion.li key={`${h.from}-${h.to}`} initial={animate ? { opacity: 0, x: 8 } : false} animate={{ opacity: 1, x: 0 }} className="flex min-w-0 items-start gap-2 text-[11px]">
                      <Disc agent={h.from} size="size-4" animate={false} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1 font-medium">
                          {AGENTS[h.from].name} <ArrowRight className="size-3 text-muted-foreground" aria-hidden /> {AGENTS[h.to].name}
                        </span>
                        <span className={cn("block truncate", MUTED)}>{h.brief}</span>
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          {next && working && (
            <p className={cn("text-[11px]", MUTED)}>
              Next: <span className="font-medium text-foreground dark:text-white">{AGENTS[next.key].name}</span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-border/70 dark:bg-white/10">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" animate={{ width: `${percent}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
      </div>
    </section>
  );
}
