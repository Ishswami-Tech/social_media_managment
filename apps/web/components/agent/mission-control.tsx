"use client";

/**
 * Mission control: the run as an operations room, two columns. Left, the team
 * as a graph: the writers side by side because they work at the same time, and
 * whoever is working opens up in place to show its tools, its stated plan and
 * its text as they arrive. Right, the running totals and what each agent
 * handed to the next. Every agent keeps its own colour end to end: its disc,
 * its card, the wire out of it, its handoff. Solid surfaces in both themes,
 * no glass. Framer Motion moves the agents; GSAP sweeps a light across the
 * room on each handoff.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Coins,
  FileCheck,
  Lightbulb,
  Columns3,
  Loader2,
  PenLine,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import {
  COUNCIL_PERSPECTIVES,
  formatDuration,
  modelLabel,
  revealStages,
  stageOfStep,
  WRITER_LANES,
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

/** Vendor colours, so a model's home is visible without reading the name. */
const VENDORS: { match: RegExp; name: string; color: string }[] = [
  { match: /^claude|anthropic/i, name: "Anthropic", color: "#d97757" },
  { match: /^gpt|^o[0-9]|openai/i, name: "OpenAI", color: "#10a37f" },
  { match: /^gemini|^imagen|google/i, name: "Google", color: "#4285f4" },
  { match: /^llama|^muse|meta/i, name: "Meta", color: "#0866ff" },
];

function vendorOf(label: string | undefined): { name: string; color: string } | undefined {
  if (!label) return undefined;
  return VENDORS.find((v) => v.match.test(label));
}

/** "Claude Fable 5.1" → "Fable 5.1": the vendor is shown as a dot, the variant is what matters here. */
function shortModel(label: string | undefined): string | undefined {
  return label?.replace(/^(Claude|OpenAI|Google)\s+/i, "");
}

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

/** A model name with its vendor's colour dot. */
function ModelTag({ label, className }: { label: string | undefined; className?: string }) {
  if (!label) return null;
  const vendor = vendorOf(label);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)} title={vendor ? `${label} · ${vendor.name}` : label}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: vendor?.color ?? "currentColor" }} aria-hidden />
      <span className="truncate">{shortModel(label)}</span>
    </span>
  );
}

function Disc({ agent, size = "size-7", pulse, animate }: { agent: ProgressStageKey; size?: string; pulse?: boolean; animate: boolean }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", size)}>
      {pulse && animate && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
            animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            aria-hidden
          />
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
            animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: 0.8 }}
            aria-hidden
          />
        </>
      )}
      <span
        className="relative inline-flex size-full items-center justify-center rounded-full text-white shadow-sm"
        style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
        aria-hidden
      >
        <Icon className="size-[50%]" strokeWidth={1.8} />
      </span>
    </span>
  );
}

interface Orb {
  key: string;
  label: string;
  /** Text from this model is arriving right now. */
  live: boolean;
}

/**
 * The models behind a working seat, as small orbs circling its disc in their
 * vendors' colours. An orb swells while its model's text is arriving, so
 * three seats streaming look like three seats streaming.
 */
function CouncilOrbit({ agent, orbs, animate }: { agent: ProgressStageKey; orbs: Orb[]; animate: boolean }) {
  if (orbs.length < 2) return null;
  const identity = AGENTS[agent];
  return (
    <motion.span
      className="pointer-events-none absolute -inset-2"
      animate={animate ? { rotate: 360 } : undefined}
      transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
      aria-hidden
    >
      {orbs.map((o, i) => {
        const angle = (i / orbs.length) * 2 * Math.PI - Math.PI / 2;
        const color = vendorOf(o.label)?.color ?? identity.to;
        return (
          <motion.span
            key={o.key}
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card dark:ring-[#0b0a14]"
            style={{ left: `${50 + 50 * Math.cos(angle)}%`, top: `${50 + 50 * Math.sin(angle)}%`, background: color }}
            animate={o.live && animate ? { scale: [1, 1.6, 1], boxShadow: [`0 0 0 0 ${color}00`, `0 0 8px 2px ${color}aa`, `0 0 0 0 ${color}00`] } : { scale: 1 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.25 }}
          />
        );
      })}
    </motion.span>
  );
}

/** Which seat of a council a live step belongs to: "research:m2" → 2. */
function seatNumber(step: string): number | undefined {
  const n = step.match(/:m(\d+)(?:#|$)/)?.[1];
  return n ? Number(n) : undefined;
}

/** The agent as a member of staff: on duty, done, stuck, standing by. */
function Duty({ state }: { state: ProgressStage["state"] }) {
  const base = "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide";
  if (state === "active")
    return (
      <span className={cn(base, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>
        <Loader2 className="size-2.5 animate-spin" aria-hidden /> On duty
      </span>
    );
  if (state === "done")
    return (
      <span className={cn(base, "bg-emerald-500/10 text-emerald-700/80 dark:text-emerald-300/80")}>
        <CheckCircle2 className="size-2.5" aria-hidden /> Done
      </span>
    );
  if (state === "failed")
    return (
      <span className={cn(base, "bg-rose-500/15 text-rose-700 dark:text-rose-300")}>
        <AlertTriangle className="size-2.5" aria-hidden /> Stuck
      </span>
    );
  if (state === "pending")
    return (
      <span className={cn(base, "bg-muted text-muted-foreground dark:bg-white/10 dark:text-white/50")}>
        <Clock className="size-2.5" aria-hidden /> Standing by
      </span>
    );
  return null;
}

/** The wire from one agent to the next, in the sender's colour, with a packet riding it while work flows. */
function Wire({ from, flowing, done, animate }: { from: ProgressStageKey; flowing: boolean; done: boolean; animate: boolean }) {
  const identity = AGENTS[from];
  return (
    <span
      className={cn("relative ml-[13px] block h-4 w-0.5 overflow-hidden rounded-full", !(done || flowing) && "bg-border/70 dark:bg-white/10")}
      style={done || flowing ? { backgroundImage: `linear-gradient(to bottom, ${identity.to}, color-mix(in oklab, ${identity.to} 33%, transparent))` } : undefined}
      aria-hidden
    >
      {flowing &&
        animate &&
        [0, 0.4].map((delay) => (
          <motion.span
            key={delay}
            className="absolute left-0 top-0 h-2 w-0.5 rounded-full bg-white"
            style={{ boxShadow: `0 0 6px 1px ${identity.to}` }}
            animate={{ y: [-8, 18] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear", delay }}
          />
        ))}
    </span>
  );
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/80 align-middle dark:bg-white/80" aria-hidden />;
}

/** What one live model call looks like on stage: the plan, then the text arriving. */
function LiveText({ p, animate, label, color, compact }: { p: LivePartial; animate: boolean; label: string; color: string; compact?: boolean }) {
  return (
    <motion.div layout={animate} initial={animate ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} exit={animate ? { opacity: 0 } : undefined} className={cn(PANEL, "min-w-0 border-l-2", compact && "p-2")} style={{ borderLeftColor: color }}>
      <div className={cn("mb-1 flex min-w-0 items-center gap-1.5 text-[11px]", MUTED)}>
        <PenLine className="size-3 shrink-0" style={{ color }} aria-hidden />
        <span className="truncate font-medium text-foreground dark:text-white">{label}</span>
        {!compact && <ModelTag label={modelLabel(p.model, p.provider)} />}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums">
          {/* A blink for every packet that lands. */}
          <motion.span key={p.chars} className="size-1.5 rounded-full" style={{ background: color }} initial={animate ? { opacity: 1, scale: 1.6 } : false} animate={{ opacity: 0.35, scale: 1 }} transition={{ duration: 0.5 }} aria-hidden />
          <CountUp value={p.text.length} /> chars
        </span>
      </div>
      {compact && <ModelTag label={modelLabel(p.model, p.provider)} className={cn("mb-1 text-[10px]", MUTED)} />}
      {p.note && (
        <p className={cn("mb-1 flex items-start gap-1.5 text-[12px] italic", MUTED)}>
          <Lightbulb className="mt-0.5 size-3 shrink-0 text-amber-500" aria-hidden />
          <span>{p.note}</span>
        </p>
      )}
      <p className={cn("overflow-hidden whitespace-pre-wrap leading-relaxed [mask-image:linear-gradient(to_bottom,black_70%,transparent)]", compact ? "max-h-20 text-[12px]" : "max-h-28 text-[13px]", BODY)}>
        {p.text || (p.chars > 0 ? "Thinking…" : "Starting…")}
        <Cursor />
      </p>
    </motion.div>
  );
}

/** Everything live for one agent: its tool calls and its answer so far. */
function LiveBlock({ stage, partials, animate }: { stage: ProgressStage; partials: LivePartial[]; animate: boolean }) {
  const identity = AGENTS[stage.key];
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
                <Wrench className="size-3 shrink-0" style={{ color: identity.to }} aria-hidden />
                <span className="font-medium">{t.tool}</span>
                {t.text && <span className={cn("truncate italic", MUTED)}>{t.text}</span>}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <div className={cn("grid min-w-0 gap-1.5", texts.length > 1 && "md:grid-cols-[repeat(3,minmax(0,1fr))]")}>
        <AnimatePresence initial={false}>
          {texts.map((p) => {
            const seat = seatNumber(p.step);
            const perspective = seat ? COUNCIL_PERSPECTIVES[stage.key]?.[seat - 1]?.name : undefined;
            const label = p.label ? `Quill ${p.label}` : seat ? `${identity.name} · ${perspective ?? `seat ${seat}`}` : identity.name;
            return <LiveText key={p.step} p={p} animate={animate} label={label} color={identity.to} compact={texts.length > 1} />;
          })}
        </AnimatePresence>
      </div>
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

function NodeCard({
  stage,
  model,
  models,
  partials,
  upNext,
  animate,
}: {
  stage: ProgressStage;
  model?: string;
  models?: string[];
  partials: LivePartial[];
  /** The seat that takes over next: it stirs while it waits. */
  upNext: boolean;
  animate: boolean;
}) {
  const identity = AGENTS[stage.key];
  const active = stage.state === "active";
  const done = stage.state === "done";
  const failed = stage.state === "failed";
  const pending = stage.state === "pending";
  const flash = useRef<HTMLSpanElement>(null);
  const previous = useRef(stage.state);
  // Finishing a stage lights the card up in the agent's colour for a moment.
  useEffect(() => {
    const was = previous.current;
    previous.current = stage.state;
    if (!animate || !flash.current || was !== "active" || stage.state !== "done") return;
    const tween = gsap.fromTo(flash.current, { opacity: 0.55 }, { opacity: 0, duration: 1.4, ease: "power2.out" });
    return () => {
      tween.kill();
    };
  }, [stage.state, animate]);
  const streaming = partials.filter((p) => p.kind !== "tool");
  const orbs: Orb[] =
    streaming.length > 0
      ? streaming.map((p) => ({ key: p.step, label: modelLabel(p.model, p.provider) ?? p.model, live: true }))
      : (models ?? []).map((m) => ({ key: m, label: m, live: active }));
  return (
    <motion.div
      layout={animate}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-l-[3px] px-2 py-1.5",
        pending && "border-dashed opacity-45",
        stage.state === "skipped" && "opacity-60",
        failed && "border-rose-500/50",
      )}
      style={{
        borderLeftColor: failed ? "#f43f5e" : pending ? undefined : identity.to,
        ...(active
          ? {
              backgroundColor: `color-mix(in oklab, ${identity.from} 10%, transparent)`,
              borderTopColor: `color-mix(in oklab, ${identity.to} 40%, transparent)`,
              borderRightColor: `color-mix(in oklab, ${identity.to} 40%, transparent)`,
              borderBottomColor: `color-mix(in oklab, ${identity.to} 40%, transparent)`,
              borderLeftColor: identity.to,
            }
          : {}),
      }}
      animate={
        active && animate
          ? { boxShadow: [`0 0 0 0px color-mix(in oklab, ${identity.to} 0%, transparent)`, `0 0 0 4px color-mix(in oklab, ${identity.to} 20%, transparent)`, `0 0 0 0px color-mix(in oklab, ${identity.to} 0%, transparent)`] }
          : upNext && pending && animate
            ? { opacity: [0.45, 0.8, 0.45], boxShadow: "0 0 0 0px transparent" }
            : { boxShadow: "0 0 0 0px transparent" }
      }
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
    >
      <span ref={flash} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" style={{ background: identity.to }} />
      {active && animate && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/2 animate-[mc-shimmer_2.2s_ease-in-out_infinite]"
          style={{ backgroundImage: `linear-gradient(90deg, transparent, color-mix(in oklab, ${identity.to} 13%, transparent), transparent)` }}
        />
      )}
      <span className="relative inline-flex shrink-0">
        <Disc agent={stage.key} pulse={active && orbs.length < 2} animate={animate} />
        {active && <CouncilOrbit agent={stage.key} orbs={orbs} animate={animate} />}
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
          {identity.name}
          <Duty state={stage.state} />
        </span>
        <span className={cn("block truncate text-[10.5px]", MUTED, failed && "text-rose-600 dark:text-rose-300")}>{pending ? identity.role : (stage.activity.at(-1) ?? identity.role)}</span>
        {!pending && models && models.length > 1 ? (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/80 dark:text-white/50">
            <span className="font-medium" style={{ color: identity.to }}>
              {models.length} models
            </span>
            {models.map((m, i) => (
              <motion.span key={m} className="inline-flex min-w-0" initial={animate ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <ModelTag label={m} />
              </motion.span>
            ))}
          </span>
        ) : (
          model && !pending && <ModelTag label={model} className="text-[10px] text-muted-foreground/80 dark:text-white/50" />
        )}
      </span>
      {done && (
        <motion.span initial={animate ? { scale: 0, rotate: -30 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}>
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </motion.span>
      )}
      {failed && <AlertTriangle className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />}
    </motion.div>
  );
}

function WriterTile({ seat, partial, animate }: { seat: AgentSeat; partial?: LivePartial | undefined; animate: boolean }) {
  const identity = AGENTS.drafting;
  const active = seat.state === "active";
  const vendor = vendorOf(seat.modelLabel);
  return (
    <motion.div
      layout={animate}
      className={cn(
        "relative grid min-w-0 justify-items-center gap-0.5 overflow-hidden rounded-lg border px-1 py-1.5 text-center",
        seat.state === "done" && "border-emerald-500/40",
        seat.state === "failed" && "border-rose-500/50",
        seat.state === "pending" && "border-dashed opacity-45",
        seat.winner && "border-emerald-500",
      )}
      style={active ? { backgroundColor: `color-mix(in oklab, ${identity.from} 10%, transparent)`, borderColor: `color-mix(in oklab, ${identity.to} 40%, transparent)` } : undefined}
      animate={active && animate ? { boxShadow: [`0 0 0 0px color-mix(in oklab, ${identity.to} 0%, transparent)`, `0 0 0 4px color-mix(in oklab, ${identity.to} 20%, transparent)`, `0 0 0 0px color-mix(in oklab, ${identity.to} 0%, transparent)`] } : { boxShadow: "0 0 0 0px transparent" }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      title={`${seat.name}${seat.modelLabel ? ` · ${seat.modelLabel}` : ""} · ${seat.detail}`}
    >
      {seat.winner && (
        <motion.span initial={animate ? { scale: 0, rotate: -20 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="absolute right-1 top-1 inline-flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white" aria-label="Judge's pick">
          <Award className="size-2.5" aria-hidden />
        </motion.span>
      )}
      <span className="relative">
        <Disc agent="drafting" size="size-6" pulse={active} animate={animate} />
        {vendor && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card dark:ring-[#0b0a14]" style={{ background: vendor.color }} aria-hidden />}
      </span>
      <span className="text-[11px] font-medium" style={{ color: identity.to }}>
        {seat.label}
      </span>
      <span className={cn("w-full max-w-full break-words text-[9.5px] leading-tight", MUTED)}>{shortModel(seat.modelLabel) ?? (seat.state === "pending" ? "waiting" : "…")}</span>
      {active && partial && (
        <span className="inline-flex items-center gap-1 text-[9.5px] tabular-nums" style={{ color: identity.to }}>
          <motion.span key={partial.chars} className="size-1 rounded-full" style={{ background: identity.to }} initial={animate ? { opacity: 1, scale: 1.8 } : false} animate={{ opacity: 0.4, scale: 1 }} transition={{ duration: 0.5 }} aria-hidden />
          <CountUp value={partial.text.length} /> chars
        </span>
      )}
      {seat.state === "done" && !seat.winner && <CheckCircle2 className="absolute right-1 top-1 size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />}
      {seat.state === "failed" && <AlertTriangle className="absolute right-1 top-1 size-3 text-rose-600 dark:text-rose-400" aria-hidden />}
    </motion.div>
  );
}

const JUDGE_MAX = 60;

/** The three drafts side by side: lane, model, the reviewer's verdict, the judge's score, the text. */
function DraftCompare({ writers, animate }: { writers: AgentSeat[]; animate: boolean }) {
  const identity = AGENTS.drafting;
  return (
    <motion.div
      initial={animate ? { opacity: 0, height: 0 } : false}
      animate={{ opacity: 1, height: "auto" }}
      exit={animate ? { opacity: 0, height: 0 } : undefined}
      className="overflow-hidden"
    >
      <div className="mt-2 grid gap-2 md:grid-cols-[repeat(3,minmax(0,1fr))]">
        {writers.map((w) => {
          const lane = w.label ? WRITER_LANES[w.label] : undefined;
          const pct = w.score !== undefined ? Math.round((w.score / JUDGE_MAX) * 100) : undefined;
          return (
            <motion.article
              key={w.label}
              initial={animate ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (w.label ?? "A").charCodeAt(0) % 3 * 0.1, duration: 0.35 }}
              className={cn("grid min-w-0 content-start gap-1.5 rounded-xl border p-2.5 text-[12px]", w.winner ? "border-emerald-500" : "border-border dark:border-white/15")}
              style={w.winner ? { backgroundColor: "#10b9811a" } : undefined}
            >
              <header className="flex flex-wrap items-center gap-1.5">
                <Disc agent="drafting" size="size-5" animate={false} />
                <span className="font-semibold" style={{ color: identity.to }}>
                  Quill {w.label}
                </span>
                {lane && <span className={cn("rounded-full border px-1.5 text-[10px]", MUTED)} title={lane.brief}>{lane.name} lane</span>}
                {w.winner && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500 px-1.5 py-px text-[10px] font-semibold text-white">
                    <Award className="size-2.5" aria-hidden /> Judge&rsquo;s pick
                  </span>
                )}
              </header>
              <ModelTag label={w.modelLabel} className={cn("text-[10.5px]", MUTED)} />
              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                {w.reviewVerdict && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px font-semibold", w.reviewVerdict === "PASS" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
                    <ShieldCheck className="size-2.5" aria-hidden /> Lens: {w.reviewVerdict}
                    {w.reviewIssues ? ` · ${w.reviewIssues} note${w.reviewIssues === 1 ? "" : "s"}` : ""}
                  </span>
                )}
                {w.state === "failed" && <span className="text-rose-600 dark:text-rose-300">did not finish</span>}
              </div>
              {pct !== undefined && (
                <div className="grid gap-0.5">
                  <span className={cn("flex justify-between text-[10px]", MUTED)}>
                    <span>Verdict&rsquo;s score</span>
                    <span className="tabular-nums">{w.score}/{JUDGE_MAX}</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-white/10">
                    <motion.span className={cn("block h-full rounded-full", w.winner ? "bg-emerald-500" : "bg-gradient-to-r from-brand to-brand-2")} initial={animate ? { width: 0 } : false} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
                  </span>
                  {w.rationale && <span className={cn("text-[10.5px]", MUTED)}>{w.rationale}</span>}
                </div>
              )}
              <p className={cn("max-h-56 overflow-y-auto whitespace-pre-wrap leading-snug", BODY)}>{w.draft ?? (w.state === "pending" ? "Waiting for the angle." : "No text.")}</p>
            </motion.article>
          );
        })}
      </div>
    </motion.div>
  );
}

/** The single-seat agent behind a stage, if the stage has one. */
function seatFor(board: AgentBoard, key: ProgressStageKey): AgentSeat | undefined {
  return board.seats.find((s) => s.role === key);
}

function TeamGraph({ stages, board, partials, animate }: { stages: ProgressStage[]; board: AgentBoard; partials: LivePartial[]; animate: boolean }) {
  const activeIndex = stages.findIndex((s) => s.state === "active");
  const landed = board.writers.filter((w) => w.draft && !w.streaming);
  const [compare, setCompare] = useState(false);
  const comparable = board.writers.filter((w) => w.draft).length;
  return (
    <div className="min-w-0 overflow-hidden">
      <p className={cn(CAP, "mb-2")}>The team</p>
      <div className="grid grid-cols-[minmax(0,1fr)]">
        {stages.map((stage, i) => {
          const previous = stages[i - 1];
          const flowing = i === activeIndex;
          const doneWire = i > 0 && i <= activeIndex - 1;
          const isWriters = stage.key === "drafting" && board.writers.length > 0;
          const mine = partials.filter((p) => stageOfPartial(p) === stage.key);
          const open = stage.state === "active" || stage.state === "failed";
          return (
            <motion.div key={stage.key} className="min-w-0" initial={animate ? { opacity: 0, x: -10 } : false} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.35 }}>
              {previous && <Wire from={previous.key} flowing={flowing} done={doneWire || (activeIndex < 0 && stage.state !== "pending")} animate={animate} />}
              {isWriters ? (
                <div className={cn("min-w-0 rounded-lg", stage.state === "pending" && "opacity-45")}>
                  <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1">
                    {board.writers.map((w) => (
                      <WriterTile key={w.label} seat={w} partial={mine.find((p) => p.kind !== "tool" && p.label === w.label)} animate={animate} />
                    ))}
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <span className={cn("text-[10px]", MUTED)}>Quill · three writers, three models, at the same time</span>
                    {comparable > 1 && (
                      <button
                        type="button"
                        onClick={() => setCompare((v) => !v)}
                        aria-expanded={compare}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:bg-accent dark:border-white/15 dark:hover:bg-white/10"
                        style={{ color: AGENTS.drafting.to }}
                      >
                        {compare ? <X className="size-3" aria-hidden /> : <Columns3 className="size-3" aria-hidden />}
                        {compare ? "Hide" : `Compare ${comparable} drafts`}
                      </button>
                    )}
                  </div>
                  <AnimatePresence initial={false}>{compare && <DraftCompare writers={board.writers} animate={animate} />}</AnimatePresence>
                  {stage.state === "active" && <LiveBlock stage={stage} partials={mine} animate={animate} />}
                  {stage.state === "active" && landed.length > 0 && (
                    <div className="ml-9 mt-1.5 grid gap-1">
                      {landed.map((w) => (
                        <p key={w.label} className={cn("flex items-center gap-1.5 truncate rounded-lg bg-muted/60 px-2.5 py-1.5 text-[12px] dark:bg-white/[0.04]", MUTED)}>
                          <FileCheck className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                          <span className="font-medium text-foreground dark:text-white">Quill {w.label} landed</span>
                          <span className="truncate">· {w.draft}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <NodeCard
                    stage={stage}
                    model={board.modelsByStage[stage.key]}
                    models={seatFor(board, stage.key)?.models}
                    partials={mine}
                    upNext={activeIndex >= 0 && i === activeIndex + 1}
                    animate={animate}
                  />
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

const TOTALS = [
  { key: "facts", label: "Facts", icon: BookOpen, color: "#0ea5e9" },
  { key: "drafts", label: "Drafts", icon: PenLine, color: "#8b5cf6" },
  { key: "notesFixed", label: "Notes fixed", icon: ShieldCheck, color: "#f59e0b" },
  { key: "failedCalls", label: "Failed calls", icon: AlertTriangle, color: "#f43f5e" },
] as const;

function Total({ label, icon: Icon, color, value, animate }: { label: string; icon: typeof BookOpen; color: string; value: number; animate: boolean }) {
  return (
    <div className={cn(PANEL, "relative min-w-0 overflow-hidden")}>
      <span className={cn("flex items-center gap-1 truncate text-[10px]", MUTED)}>
        <Icon className="size-3 shrink-0" style={{ color }} aria-hidden /> {label}
      </span>
      <motion.span key={value} initial={animate ? { scale: 1.25 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }} className="block origin-left text-lg font-semibold tabular-nums">
        <CountUp value={value} />
      </motion.span>
    </div>
  );
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
  const models = new Set([...board.seats.flatMap((s) => s.models ?? []), ...board.writers.flatMap((w) => (w.modelLabel ? [w.modelLabel] : []))]).size;
  const failedCalls = transcript.filter((m) => m.tone === "failed").length;
  const active = stages.find((s) => s.state === "active");
  // Not running and a seat is stuck: the run stopped, it did not finish.
  const halted = !working && stages.some((s) => s.state === "failed");
  const activeKey = active?.key ?? null;
  const accent = active ? AGENTS[active.key].to : undefined;
  const room = useRef<HTMLElement>(null);
  const values = { facts: stats?.facts ?? 0, drafts: stats?.drafts ?? 0, notesFixed: stats?.notesFixed ?? 0, failedCalls };

  // GSAP: a handoff sends a light sweep across the room in the new agent's colour.
  useEffect(() => {
    const root = room.current;
    if (!root || !animate || !activeKey) return;
    const sweep = root.querySelector<HTMLElement>("[data-sweep]");
    if (!sweep) return;
    const tween = gsap.fromTo(sweep, { xPercent: -130, opacity: 0.6 }, { xPercent: 130, opacity: 0, duration: 1.2, ease: "power2.inOut" });
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
      <div
        data-sweep
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 opacity-0"
        style={{ backgroundImage: `linear-gradient(90deg, transparent, ${accent ?? "var(--brand)"}33, transparent)` }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:18px_18px] dark:opacity-20" />

      <header className={cn("relative mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em]", MUTED)}>
        <span className="flex items-center gap-2">
          <Signal working={working} animate={animate} />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              working ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : halted ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-brand/15 text-brand",
            )}
          >
            {working && <motion.span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" animate={animate ? { opacity: [1, 0.25, 1], scale: [1, 0.8, 1] } : undefined} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} aria-hidden />}
            {working ? "Live" : halted ? "Stopped" : "Finished"}
          </span>
          {elapsedMs !== null && (
            <span className="inline-flex items-center gap-1 tabular-nums text-foreground/80 dark:text-white/80">
              <Clock className="size-3" aria-hidden /> {formatDuration(elapsedMs)}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          {models > 0 && (
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
              <span className="inline-flex -space-x-1" aria-hidden>
                {VENDORS.map((v) => (
                  <span key={v.name} className="size-2.5 rounded-full ring-1 ring-card dark:ring-[#0b0a14]" style={{ background: v.color }} />
                ))}
              </span>
              {models} model{models === 1 ? "" : "s"} on this run
            </span>
          )}
          <span className="tabular-nums">
            {done} / {stages.length}
          </span>
        </span>
      </header>

      <div className="relative grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <TeamGraph stages={stages} board={board} partials={live} animate={animate} />

        <div className="grid min-w-0 content-start gap-3 overflow-hidden">
          <div className="grid grid-cols-2 gap-1.5">
            {TOTALS.map((t) => (
              <Total key={t.key} label={t.label} icon={t.icon} color={t.color} value={values[t.key]} animate={animate} />
            ))}
            {(stats?.spentCents ?? 0) > 0 && (
              <div className={cn(PANEL, "col-span-2")}>
                <span className={cn("flex items-center gap-1 text-[10px]", MUTED)}>
                  <Coins className="size-3 text-amber-500" aria-hidden /> Spend
                </span>
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
                    <motion.li
                      key={`${h.from}-${h.to}`}
                      initial={animate ? { opacity: 0, x: 12, backgroundColor: `color-mix(in oklab, ${AGENTS[h.to].to} 20%, transparent)` } : false}
                      animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
                      transition={{ duration: 0.6 }}
                      className="flex min-w-0 items-start gap-2 rounded-lg px-1 py-0.5 text-[11px]"
                    >
                      <Disc agent={h.from} size="size-4" animate={false} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1 font-medium">
                          {AGENTS[h.from].name}
                          <ArrowRight className="size-3" style={{ color: AGENTS[h.to].to }} aria-hidden />
                          {AGENTS[h.to].name}
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
            <p className={cn("flex items-center gap-1.5 text-[11px]", MUTED)}>
              Next <Disc agent={next.key} size="size-4" animate={false} /> <span className="font-medium text-foreground dark:text-white">{AGENTS[next.key].name}</span>
            </p>
          )}
        </div>
      </div>

      <div className="relative mt-4 h-[3px] overflow-hidden rounded-full bg-border/70 dark:bg-white/10">
        <motion.div className="relative h-full overflow-hidden rounded-full" style={{ backgroundImage: `linear-gradient(90deg, var(--brand), ${accent ?? "var(--brand-2)"})` }} animate={{ width: `${Math.max(percent, working ? 4 : 0)}%` }} transition={{ duration: 0.8, ease: "easeOut" }}>
          {working && animate && <span aria-hidden className="absolute inset-y-0 w-1/3 animate-[mc-shimmer_1.6s_linear_infinite] bg-white/50" />}
        </motion.div>
      </div>
    </section>
  );
}
