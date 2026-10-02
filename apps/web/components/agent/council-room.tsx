"use client";

/**
 * The council room: the run as a conversation. Every agent posts what it did
 * the moment its event lands, the agent at work shows a typing bubble, and a
 * writer's live text streams into its own bubble while the model is still
 * talking. Everything comes from the same events the arc and the board use.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Award, Pause, Play, Radio, RefreshCw, ShieldCheck, Sparkles, Zap } from "lucide-react";
import {
  buildBoard,
  buildProgress,
  buildTranscript,
  formatDuration,
  modelLabel,
  providerName,
  shortReason,
  stageOfStep,
  WRITER_LANES,
  type AgentBoard,
  type AgentSeat,
  type ProgressStage,
  type ProgressStageKey,
  type SeatRole,
  type TranscriptMessage,
} from "@platform/agent-council/progress";
import { applyPartials, type LivePartial } from "@platform/agent-council/live";
import { AGENTS } from "@/components/agent/agents";
import { useRunProgress, type RunInitial } from "@/components/agent/live-progress";
import { isSettled } from "@/components/home/labels";
import { cn } from "@/lib/utils";

const JUDGE_MAX = 60;
/** Keep scrolling with the conversation only while the reader is near the bottom. */
const STICKY_BOTTOM_PX = 96;
const subscribeNever = (): (() => void) => () => {};

interface CouncilRoomProps {
  messages: TranscriptMessage[];
  stages: ProgressStage[];
  partials?: Record<string, LivePartial> | undefined;
  working: boolean;
  className?: string;
  /** Let the transcript grow to fill a tall panel instead of the compact default. */
  tall?: boolean;
}

function Avatar({ agent, pulse }: { agent: ProgressStageKey; pulse?: boolean }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className="relative mt-0.5 shrink-0">
      {pulse && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-40"
          style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
          aria-hidden
        />
      )}
      <span
        className="relative inline-flex size-7 items-center justify-center rounded-full text-white shadow-sm"
        style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>
    </span>
  );
}

function Speaker({ agent, label, model, provider, since }: { agent: ProgressStageKey; label?: string; model?: string | null; provider?: string | null; since?: string }) {
  const identity = AGENTS[agent];
  const chip = modelLabel(model, provider);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className={cn("font-semibold", identity.text)}>
        {identity.name}
        {label ? ` ${label}` : ""}
      </span>
      <span className="text-muted-foreground">{label && WRITER_LANES[label] ? `${WRITER_LANES[label]!.name} lane` : identity.role}</span>
      {chip && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          <Sparkles className="size-2.5" aria-hidden /> {chip}
        </span>
      )}
      {since && <span className="ml-auto tabular-nums text-muted-foreground/70">{since}</span>}
    </div>
  );
}

function Scores({ scores, winner, animate }: { scores: NonNullable<TranscriptMessage["output"]>["scores"]; winner?: string; animate: boolean }) {
  if (!scores?.length) return null;
  return (
    <ul className="mt-1.5 grid gap-1" aria-label="Judge scores">
      {scores.map((s) => {
        const pct = Math.max(4, Math.round((s.score / JUDGE_MAX) * 100));
        const won = s.label === winner;
        return (
          <li key={s.label} className="grid gap-0.5 text-[11px]">
            <span className="flex items-center justify-between">
              <span className={cn("font-medium", won && "text-emerald-600 dark:text-emerald-400")}>
                Draft {s.label}
                {won && <Award className="ml-1 inline size-3" aria-hidden />}
              </span>
              <span className="tabular-nums text-muted-foreground">{s.score}/{JUDGE_MAX}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.span
                className={cn("block h-full rounded-full", won ? "bg-emerald-500" : "bg-gradient-to-r from-brand to-brand-2")}
                initial={animate ? { width: 0 } : false}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </span>
            {s.rationale && <span className="text-muted-foreground">{s.rationale}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Attachments({ output, animate }: { output: TranscriptMessage["output"]; animate: boolean }) {
  if (!output) return null;
  return (
    <>
      {output.draft && (
        <blockquote className="mt-1.5 line-clamp-4 whitespace-pre-wrap border-l-2 border-brand/40 pl-2 text-[12px] leading-snug text-foreground/85">
          {output.draft}
        </blockquote>
      )}
      {output.verdict && (
        <span
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            output.verdict === "PASS" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
          )}
        >
          <ShieldCheck className="size-3" aria-hidden /> {output.verdict}
          {output.issues?.length ? ` · ${output.issues.length} note${output.issues.length === 1 ? "" : "s"}${output.fixed ? ", fixed" : ""}` : ""}
        </span>
      )}
      {output.issues && output.issues.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-[11px] text-muted-foreground">
          {output.issues.slice(0, 4).map((issue) => (
            <li key={issue}>· {issue}</li>
          ))}
        </ul>
      )}
      {output.skills && output.skills.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {output.skills.map((skill) => (
            <span key={skill} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
              {skill}
            </span>
          ))}
        </div>
      )}
      <Scores scores={output.scores} winner={output.winner} animate={animate} />
    </>
  );
}

function Bubble({ children, tone, live }: { children: React.ReactNode; tone?: TranscriptMessage["tone"]; live?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-2xl rounded-tl-md border px-3 py-2 text-[13px] leading-snug",
        tone === "failed"
          ? "border-destructive/40 bg-destructive/5"
          : live
            ? "border-brand/40 bg-brand/5 shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_10%,transparent)]"
            : "border-border bg-background",
      )}
    >
      {children}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-brand"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function sinceLabel(first: string | undefined, at: string): string | undefined {
  if (!first) return undefined;
  const ms = Date.parse(at) - Date.parse(first);
  return Number.isFinite(ms) && ms >= 0 ? `+${formatDuration(ms)}` : undefined;
}

export function CouncilRoom({ messages, stages, partials, working, className, tall }: CouncilRoomProps) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const animate = mounted && !reduced;
  const scroller = useRef<HTMLDivElement>(null);
  const active = stages.find((s) => s.state === "active");
  const live = Object.values(partials ?? {});
  const first = messages[0]?.at;
  const showTyping = working && active !== undefined && live.length === 0 && active.key !== "ready";
  const liveProgress = live.map((p) => p.chars).join(",");

  // Follow the conversation while the reader is at the bottom, like any chat.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < STICKY_BOTTOM_PX || working) el.scrollTo({ top: el.scrollHeight, behavior: animate ? "smooth" : "auto" });
  }, [messages.length, liveProgress, working, animate]);

  return (
    <section
      aria-label="Council room"
      className={cn("grid content-start gap-3 rounded-xl border border-border bg-card p-4", className)}
    >
      <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Radio className={cn("size-3.5", working && "text-brand")} aria-hidden /> Council room
        </span>
        <span>
          {working ? (
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-brand">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden /> live
            </span>
          ) : (
            `${messages.length} message${messages.length === 1 ? "" : "s"}`
          )}
        </span>
      </header>

      <div ref={scroller} className={cn("grid content-start gap-2.5 overflow-y-auto pr-1", tall ? "max-h-[calc(100vh-22rem)] min-h-[16rem]" : "max-h-[26rem]")} aria-live={working ? "polite" : "off"}>
        {messages.length === 0 && !showTyping && (
          <p className="py-6 text-center text-xs text-muted-foreground">The agents have not said anything yet.</p>
        )}
        {messages.map((m) => (
          <motion.div
            key={m.id}
            layout={animate}
            initial={animate ? { opacity: 0, y: 10, scale: 0.98 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex items-start gap-2"
          >
            <Avatar agent={m.agent} />
            <Bubble tone={m.tone}>
              <Speaker agent={m.agent} label={m.label} model={m.model} provider={m.provider} since={sinceLabel(first, m.at)} />
              <p className={cn("mt-0.5", m.tone === "failed" && "text-destructive")}>{m.text}</p>
              <Attachments output={m.output} animate={animate} />
            </Bubble>
          </motion.div>
        ))}

        <AnimatePresence initial={false}>
          {live.map((p) => {
            const agent = stageOfStep(p.step.split("#")[0] ?? p.step) ?? "drafting";
            const tool = p.kind === "tool";
            return (
              <motion.div
                key={`live-${p.step}`}
                layout={animate}
                initial={animate ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={animate ? { opacity: 0, height: 0 } : undefined}
                className="flex items-start gap-2"
              >
                <Avatar agent={agent} pulse={animate && !tool} />
                <Bubble live>
                  <Speaker agent={agent} label={p.label} model={p.model} provider={p.provider} />
                  {tool ? (
                    <p className="mt-0.5 text-muted-foreground">
                      Using <span className="font-medium text-foreground">{p.tool}</span>
                      {p.text ? <> · <span className="italic">{p.text}</span></> : null}
                    </p>
                  ) : (
                    <>
                      <p className="mt-0.5 max-h-32 overflow-hidden whitespace-pre-wrap [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                        {p.text || (p.chars > 0 ? "Thinking…" : "Starting…")}
                        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" aria-hidden />
                      </p>
                      <span className="mt-1 block text-[10px] tabular-nums text-muted-foreground">{p.text.length} characters so far</span>
                    </>
                  )}
                </Bubble>
              </motion.div>
            );
          })}

          {showTyping && active && (
            <motion.div
              key={`typing-${active.key}`}
              layout={animate}
              initial={animate ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={animate ? { opacity: 0 } : undefined}
              className="flex items-start gap-2"
            >
              <Avatar agent={active.key} pulse={animate} />
              <Bubble live>
                <Speaker agent={active.key} />
                <span className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <TypingDots />
                  {active.activity.at(-1) ?? active.label}
                </span>
              </Bubble>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The Council Room page: a dark, full-screen round table
// ---------------------------------------------------------------------------

/** Stage geometry from the design, in px of the 680×772 stage. */
const STAGE_W = 680;
const STAGE_H = 772;
const CX = 340;
const CY = 384;
const SEAT_R = 282;
const CORE = 300;

type SeatKey = "scout" | "compass" | "quillA" | "quillB" | "quillC" | "lens" | "verdict" | "polish" | "you";
type SeatState = "waiting" | "live" | "done" | "failed";

interface Seat {
  key: SeatKey;
  stage: ProgressStageKey;
  name: string;
  role: string;
  letter: string;
  angle: number;
  state: SeatState;
  status: string;
  model?: string;
}

const SEAT_DEFS: { key: SeatKey; stage: ProgressStageKey; name: string; role: string; letter: string; angle: number; label?: string }[] = [
  { key: "scout", stage: "research", name: "Scout", role: "Researcher", letter: "S", angle: 130 },
  { key: "compass", stage: "strategy", name: "Compass", role: "Strategist", letter: "C", angle: 170 },
  { key: "quillA", stage: "drafting", name: "Quill A", role: "", letter: "A", angle: 210, label: "A" },
  { key: "quillB", stage: "drafting", name: "Quill B", role: "", letter: "B", angle: 250, label: "B" },
  { key: "quillC", stage: "drafting", name: "Quill C", role: "", letter: "C", angle: 290, label: "C" },
  { key: "lens", stage: "review", name: "Lens", role: "Reviewer", letter: "L", angle: 330 },
  { key: "verdict", stage: "judge", name: "Verdict", role: "Blind judge", letter: "V", angle: 10 },
  { key: "polish", stage: "adapt", name: "Polish", role: "Editor", letter: "P", angle: 50 },
  { key: "you", stage: "ready", name: "You", role: "Approver", letter: "Y", angle: 90 },
];

/** Dark-theme agent colours; the room is always dark. */
const DARK: Record<ProgressStageKey, string> = {
  research: "#38BDF8",
  strategy: "#818CF8",
  drafting: "#C084FC",
  review: "#FBBF24",
  judge: "#FB7185",
  adapt: "#34D399",
  ready: "#F4F5F2",
};

const STAGE_STATUS: Record<ProgressStageKey, string> = {
  research: "RESEARCHING",
  strategy: "STRATEGIZING",
  drafting: "DRAFTING",
  review: "REVIEWING",
  judge: "JUDGING",
  adapt: "ADAPTING",
  ready: "AWAITING_APPROVAL",
};

const CORE_TITLE: Record<ProgressStageKey, string> = {
  research: "Researching",
  strategy: "Choosing angles",
  drafting: "Writing",
  review: "Checking",
  judge: "Judging",
  adapt: "Polishing",
  ready: "Ready for you",
};

function seatXY(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: CX + SEAT_R * Math.cos(rad), y: CY + SEAT_R * Math.sin(rad) };
}

function words(text: string | undefined): number {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function seatsFor(board: AgentBoard, stages: ProgressStage[], runStatus: string, claimCount: number): Seat[] {
  const stageOf = (k: ProgressStageKey) => stages.find((s) => s.key === k);
  const single = (role: SeatRole) => board.seats.find((s) => s.role === role);
  return SEAT_DEFS.map((d) => {
    if (d.key === "you") {
      const ready = runStatus === "AWAITING_APPROVAL";
      const done = ["APPROVED", "PUBLISHING", "COMPLETED"].includes(runStatus);
      return { ...d, state: done ? "done" : ready ? "live" : "waiting", status: done ? "Approved" : ready ? "Your turn" : "Waiting" };
    }
    if (d.stage === "drafting") {
      const w = board.writers.find((x) => x.label === d.label);
      const lane = d.label ? WRITER_LANES[d.label]?.name : undefined;
      if (!w) return { ...d, role: lane ? `${lane} lane` : "Writer", state: "waiting", status: "Waiting" };
      const state: SeatState = w.state === "done" ? "done" : w.state === "active" ? "live" : w.state === "failed" ? "failed" : "waiting";
      const status =
        state === "live"
          ? `Writing draft ${d.label}`
          : state === "done"
            ? typeof w.score === "number"
              ? `${((w.score / JUDGE_MAX) * 10).toFixed(1)}${w.winner ? " · winner" : ""}`
              : `${words(w.draft)} words`
            : state === "failed"
              ? "Stopped"
              : "Waiting";
      return { ...d, role: w.modelLabel ?? (lane ? `${lane} lane` : "Writer"), model: w.modelLabel, state, status };
    }
    const st = stageOf(d.stage);
    const seat = single(d.stage === "research" ? "research" : d.stage === "strategy" ? "strategy" : d.stage === "review" ? "review" : d.stage === "judge" ? "judge" : "adapt");
    const state: SeatState = st?.state === "done" ? "done" : st?.state === "active" ? "live" : st?.state === "failed" ? "failed" : "waiting";
    let status = state === "live" ? (seat?.detail || "Working") : state === "failed" ? "Stopped" : state === "done" ? "Done" : "Waiting";
    if (state === "done" && d.stage === "research" && claimCount) status = `${claimCount} facts`;
    return { ...d, model: seat?.modelLabel, state, status };
  });
}

function SeatButton({ seat, selected, onSelect }: { seat: Seat; selected: boolean; onSelect: () => void }) {
  const { x, y } = seatXY(seat.angle);
  const color = DARK[seat.stage];
  const live = seat.state === "live";
  const waiting = seat.state === "waiting";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${seat.name}, ${seat.status}`}
      className="cr-enter absolute flex w-[140px] -translate-x-1/2 -translate-y-[32px] flex-col items-center gap-2.5 border-0 bg-transparent p-0 text-[#E7E9EC] outline-none"
      style={{ left: `${(x / STAGE_W) * 100}%`, top: `${(y / STAGE_H) * 100}%`, opacity: waiting ? 0.55 : 1, filter: waiting ? "saturate(0.6)" : undefined }}
    >
      <span className="relative inline-flex size-16 transition-transform duration-500" style={{ transform: live || selected ? "scale(1.12)" : undefined }}>
        {live && (
          <>
            <span className="cr-halo absolute inset-0 rounded-full" style={{ background: color }} />
            <span className="cr-spin absolute -inset-2 rounded-full border-2 border-dashed" style={{ borderColor: color }} />
          </>
        )}
        <span
          className="relative inline-flex size-16 items-center justify-center rounded-full font-display text-[24px] font-extrabold text-[#0B0D10]"
          style={{
            background: seat.state === "failed" ? "#7f1d1d" : color,
            boxShadow: live ? `0 0 40px -4px ${color}` : selected ? `0 0 0 3px #090B0E, 0 0 0 5px ${color}` : undefined,
          }}
        >
          {seat.letter}
        </span>
        {seat.state === "done" && (
          <span className="cr-pop absolute -right-0.5 -bottom-0.5 inline-flex size-[22px] items-center justify-center rounded-full border-[3px] border-[#090B0E] bg-[#F4F5F2] text-[12px] font-extrabold text-[#0B0D10]">
            ✓
          </span>
        )}
      </span>
      <span className="flex flex-col items-center gap-px">
        <span className="text-[13.5px] font-bold">{seat.name}</span>
        <span className="max-w-[140px] truncate text-[11px] text-[#8A9099]">{seat.role}</span>
      </span>
      <span
        className="inline-flex h-[22px] max-w-[140px] items-center truncate rounded-full border border-[#262B32] bg-[#12161A] px-2.5 font-mono text-[10.5px] whitespace-nowrap"
        style={{ color: live ? color : seat.state === "done" ? "#C3C8CF" : seat.state === "failed" ? "#FCA5A5" : "#6B717A" }}
      >
        {seat.status}
      </span>
    </button>
  );
}

interface StageViewProps {
  seats: Seat[];
  current: ProgressStageKey;
  percent: number;
  stepIndex: number;
  coreBig: string;
  coreSub: string;
  ready: boolean;
  runId: string;
  selected: SeatKey | null;
  onSelect: (k: SeatKey) => void;
  handoff: { from: string; to: string; what: string; color: string } | null;
}

function RoundTable({ seats, current, percent, stepIndex, coreBig, coreSub, ready, runId, selected, onSelect, handoff }: StageViewProps) {
  const color = DARK[current];
  const r = 146;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="cr-stage relative mx-auto w-[680px] max-w-none shrink-0" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
      <div
        aria-hidden
        className="absolute rounded-full"
        style={{
          left: `${((CX - 330) / STAGE_W) * 100}%`,
          top: `${((CY - 330) / STAGE_H) * 100}%`,
          width: `${(660 / STAGE_W) * 100}%`,
          aspectRatio: "1",
          background: "radial-gradient(closest-side, rgba(255,255,255,0.05), rgba(255,255,255,0) 70%)",
        }}
      />
      <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} className="absolute inset-0 size-full" aria-hidden>
        <circle cx={CX} cy={CY} r={SEAT_R} fill="none" stroke="#22272E" strokeDasharray="4 6" className="cr-spin-slow" style={{ transformOrigin: `${CX}px ${CY}px` }} />
        {seats.map((seat) => {
          const { x, y } = seatXY(seat.angle);
          const k1 = (CORE / 2 + 4) / SEAT_R;
          const k2 = (SEAT_R - 36) / SEAT_R;
          const c = DARK[seat.stage];
          const live = seat.state === "live";
          return (
            <g key={seat.key}>
              <line
                x1={CX + (x - CX) * k1}
                y1={CY + (y - CY) * k1}
                x2={CX + (x - CX) * k2}
                y2={CY + (y - CY) * k2}
                stroke={live ? c : seat.state === "done" ? "#3A3F46" : "#1C2026"}
                strokeWidth={live ? 2 : 1.5}
                strokeDasharray={live ? "2 10" : undefined}
                strokeLinecap="round"
                className={live ? "cr-flow" : undefined}
                style={live ? { filter: `drop-shadow(0 0 4px ${c})` } : undefined}
              />
            </g>
          );
        })}
      </svg>

      <div
        className="absolute"
        style={{ left: `${((CX - CORE / 2) / STAGE_W) * 100}%`, top: `${((CY - CORE / 2) / STAGE_H) * 100}%`, width: `${(CORE / STAGE_W) * 100}%`, aspectRatio: "1" }}
      >
        <svg viewBox="0 0 300 300" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <circle cx="150" cy="150" r={r} fill="none" stroke="#1C2026" strokeWidth="3" />
          <circle
            cx="150"
            cy="150"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(Math.min(100, percent) / 100) * circumference} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.4s linear, stroke 0.6s" }}
          />
        </svg>
        <div aria-hidden className="cr-spin-rev absolute inset-[4%] rounded-full border border-dashed border-[#2A2F36]" />
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-[8%] flex flex-col items-center justify-center gap-1.5 rounded-full border border-[#262B32] p-[9%] text-center"
          style={{
            background: ready ? "#F4F5F2" : "#0E1115",
            color: ready ? "#0B0D10" : "#FFFFFF",
            boxShadow: `0 0 100px -16px ${color}, inset 0 0 40px rgba(0,0,0,0.35)`,
            transition: "background 0.7s, box-shadow 0.7s, color 0.7s",
          }}
        >
          <span className="font-mono text-[10.5px] tracking-[0.14em]" style={{ color: ready ? "#454B53" : "#8A9099" }}>
            STEP {stepIndex} OF 7
          </span>
          <span className="font-display text-[clamp(20px,3.6vw,34px)] leading-none font-extrabold tracking-[-0.02em]">{CORE_TITLE[current]}</span>
          <span className="font-mono text-[clamp(12px,1.8vw,16px)]">{coreBig}</span>
          <span className="max-w-[190px] text-[12px] leading-snug" style={{ color: ready ? "#454B53" : "#8A9099" }}>
            {coreSub}
          </span>
          {ready && (
            <Link
              href={`/review/${runId}`}
              className="cr-pop mt-1.5 inline-flex h-[38px] items-center gap-1.5 rounded-full bg-signal px-4 text-[13.5px] font-semibold !text-white"
            >
              Review &amp; approve <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </div>

      {seats.map((seat) => (
        <SeatButton key={seat.key} seat={seat} selected={selected === seat.key} onSelect={() => onSelect(seat.key)} />
      ))}

      {handoff && (
        <div
          key={`${handoff.from}${handoff.to}`}
          role="status"
          className="cr-rise absolute top-1 left-1/2 inline-flex h-[38px] items-center gap-2.5 rounded-full bg-[#F4F5F2] px-4 text-[13px] font-semibold whitespace-nowrap text-[#0B0D10]"
          style={{ boxShadow: `0 10px 30px -8px ${handoff.color}` }}
        >
          <span>{handoff.from}</span>
          <span aria-hidden>→</span>
          <span>{handoff.to}</span>
          <span className="h-4 w-px bg-[#C4C8C1]" />
          <span className="font-mono text-[12px] font-medium">{handoff.what}</span>
        </div>
      )}
    </div>
  );
}

const PANEL = "rounded-[20px] border border-[#1C2026] bg-[#101317]";

export interface CouncilClaim {
  id: string;
  statement: string;
  status: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
}

export interface CouncilProvider {
  provider: string;
  state: "ok" | "cooling" | "failing";
  reason?: string;
}

export interface CouncilLiveProps {
  runId: string;
  topic: string;
  initial: RunInitial;
  canManage: boolean;
  claims: CouncilClaim[];
  providers: CouncilProvider[];
}

const SPEEDS = [1, 2, 4] as const;
const MAX_REPLAY_GAP_MS = 2500;
const TICK_MS = 150;

function stageForStatus(status: string): ProgressStageKey {
  const map: Record<string, ProgressStageKey> = {
    QUEUED: "research",
    RESEARCHING: "research",
    STRATEGIZING: "strategy",
    DRAFTING: "drafting",
    REVIEWING: "review",
    JUDGING: "judge",
    ADAPTING: "adapt",
  };
  return map[status] ?? "ready";
}

/**
 * The council at its round table. Live while the run works (the same stream
 * as every other progress view); afterwards a replay of the stored events at
 * 1×, 2× or 4×. Tap any seat to look inside it.
 */
export function CouncilLive({ runId, topic, initial, canManage, claims, providers }: CouncilLiveProps) {
  const router = useRouter();
  const { snapshot, live, reconnect } = useRunProgress(runId, initial, () => router.refresh());
  const events = useMemo(() => [...snapshot.events].sort((a, b) => a.at.localeCompare(b.at)), [snapshot.events]);
  const start = initial.startedAt ? Date.parse(initial.startedAt) : events[0] ? Date.parse(events[0].at) : 0;
  const lastAt = events.at(-1) ? Date.parse(events.at(-1)!.at) : start;
  const working = !isSettled(snapshot.status) || snapshot.status === "APPROVED";

  // Replay: null = follow the run; otherwise milliseconds since start being shown.
  const [cursor, setCursor] = useState<number | null>(working ? null : 0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [picked, setPicked] = useState<SeatKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Replays play the stored events back with long waits squeezed to at most a few seconds,
  // so a run that sat for days before a decision still replays in about a minute.
  const replayAt = useMemo(() => {
    const out: number[] = [];
    let prev = start;
    let t = 0;
    for (const e of events) {
      const at = Date.parse(e.at);
      t += Math.min(MAX_REPLAY_GAP_MS, Math.max(0, at - prev));
      prev = at;
      out.push(t);
    }
    return out;
  }, [events, start]);
  const span = Math.max(1, replayAt.at(-1) ?? 1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (cursor === null || !playing) return;
      // Replays compress long gaps so a 10-minute run plays back in about a minute at 1×.
      const step = TICK_MS * speed;
      setCursor((c) => {
        if (c === null) return c;
        const next = c + step;
        if (next >= span) {
          setPlaying(false);
          return span;
        }
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [cursor, playing, speed, span]);

  const replaying = cursor !== null;
  const shown = useMemo(
    () => (replaying ? events.filter((_, i) => (replayAt[i] ?? 0) <= cursor!) : events),
    [events, replaying, cursor, replayAt],
  );
  const lastShown = shown.at(-1);
  const lastStage = [...shown].reverse().map((e) => stageOfStep(e.step)).find((k): k is ProgressStageKey => k !== null);
  const viewStatus = !replaying || (cursor ?? 0) >= span ? snapshot.status : lastStage ? STAGE_STATUS[lastStage] : "RESEARCHING";
  const progress = useMemo(() => buildProgress(viewStatus, shown, snapshot.accounts, { claimCount: snapshot.claimCount }), [viewStatus, shown, snapshot.accounts, snapshot.claimCount]);
  const board = useMemo(() => {
    const b = buildBoard(viewStatus, shown, snapshot.accounts);
    return replaying ? b : applyPartials(b, snapshot.partials);
  }, [viewStatus, shown, snapshot.accounts, snapshot.partials, replaying]);
  const transcript = useMemo(() => buildTranscript(shown, snapshot.accounts, { claimCount: snapshot.claimCount }), [shown, snapshot.accounts, snapshot.claimCount]);
  const seats = useMemo(() => seatsFor(board, progress.stages, viewStatus, snapshot.claimCount), [board, progress.stages, viewStatus, snapshot.claimCount]);

  const current: ProgressStageKey = viewStatus === "AWAITING_APPROVAL" || isSettled(viewStatus) ? "ready" : stageForStatus(viewStatus);
  const ready = current === "ready" && !["FAILED", "CANCELLED", "BLOCKED"].includes(viewStatus);
  const stepIndex = Math.max(1, ["research", "strategy", "drafting", "review", "judge", "adapt", "ready"].indexOf(current) + 1);
  const liveSeat = seats.find((s) => s.state === "live");
  const selectedKey: SeatKey = picked ?? liveSeat?.key ?? (ready ? "you" : "scout");
  const selected = seats.find((s) => s.key === selectedKey)!;

  const draftWords = board.writers.reduce((a, w) => a + words(w.draft), 0);
  const coreBig =
    current === "drafting"
      ? `${draftWords} words`
      : current === "research"
        ? `${snapshot.claimCount} facts`
        : current === "judge"
          ? `${board.writers.length} drafts`
          : current === "review"
            ? `${shown.filter((e) => e.step.startsWith("review:") && e.status === "SUCCEEDED").length} of ${board.writers.length || 3} checked`
            : current === "adapt"
              ? `${snapshot.accounts.length} platform${snapshot.accounts.length === 1 ? "" : "s"}`
          : ready
            ? `${snapshot.accounts.length} post${snapshot.accounts.length === 1 ? "" : "s"} ready`
            : (progress.stages.find((s) => s.key === current)?.label ?? "");
  const coreSub =
    current === "drafting"
      ? `${board.writers.length || 3} drafts, ${new Set(board.writers.map((w) => w.modelLabel).filter(Boolean)).size || 3} models, in parallel`
      : ready
        ? "Nothing goes out until you approve it."
        : (progress.stages.find((s) => s.key === current)?.activity.at(-1) ?? "");

  // Hand-off banner: shown briefly when a new stage starts.
  const handoff = useMemo(() => {
    const order: ProgressStageKey[] = ["research", "strategy", "drafting", "review", "judge", "adapt", "ready"];
    const i = order.indexOf(current);
    if (i <= 0) return null;
    const prev = order[i - 1]!;
    const startedAt = progress.stages.find((s) => s.key === current)?.startedAt;
    const at = replaying ? (lastShown ? Date.parse(lastShown.at) : start) : now;
    if (!startedAt || at - Date.parse(startedAt) > 4000) return null;
    const what = prev === "research" ? `${snapshot.claimCount} facts` : prev === "drafting" ? `${board.writers.length} drafts` : "done";
    return { from: AGENTS[prev].name, to: current === "drafting" ? "3 Quills" : AGENTS[current].name, what, color: DARK[current] };
  }, [current, progress.stages, replaying, start, lastShown, now, snapshot.claimCount, board.writers.length]);

  // Caption: the newest thing anyone said, or the live text arriving.
  const partial = !replaying ? Object.values(snapshot.partials ?? {}).at(-1) : undefined;
  const lastMsg = transcript.at(-1);
  const captionStage = partial ? (stageOfStep(partial.step.split("#")[0] ?? partial.step) ?? "drafting") : (lastMsg?.agent ?? current);
  const captionWho = partial ? `${AGENTS[captionStage].name}${partial.label ? ` ${partial.label}` : ""}` : lastMsg ? `${AGENTS[lastMsg.agent].name}${lastMsg.label ? ` ${lastMsg.label}` : ""}` : AGENTS[current].name;
  const captionText = partial ? (partial.kind === "tool" ? `Using ${partial.tool ?? "a tool"}…` : partial.text.slice(-160) || "Thinking…") : (lastMsg?.text ?? "Taking a seat…");

  const elapsed = replaying ? (lastShown ? Date.parse(lastShown.at) - start : 0) : working ? now - start : lastAt - start;
  const reviewed = shown.filter((e) => e.step.startsWith("review:") && e.status === "SUCCEEDED").length;
  const reviewTotal = Math.max(reviewed, board.writers.length);
  const modelCalls = shown.filter((e) => e.model && e.status !== "STARTED").length;
  const supported = claims.filter((c) => c.status === "SUPPORTED").length;
  const sources = new Set(claims.map((c) => c.sourceUrl).filter(Boolean)).size;
  const tele = [
    { label: "Sources read", v: String(sources), w: Math.min(100, sources * 12), c: DARK.research },
    { label: "Facts verified", v: String(supported), w: Math.min(100, supported * 15), c: DARK.research },
    { label: "Words written", v: String(draftWords), w: Math.min(100, draftWords / 6), c: DARK.drafting },
    { label: "Checks passed", v: `${reviewed}/${reviewTotal || 0}`, w: reviewTotal ? (reviewed / reviewTotal) * 100 : 0, c: DARK.review },
    { label: "Model calls", v: String(modelCalls), w: Math.min(100, modelCalls * 6), c: DARK.strategy },
  ];

  const segs = progress.stages.filter((s) => s.key !== "ready");
  // Where each stage begins on the replay clock (for jumping) and on the real clock (for the label).
  const segStart = (key: ProgressStageKey) => {
    const i = events.findIndex((e) => stageOfStep(e.step) === key);
    return i >= 0 ? (replayAt[i] ?? 0) : null;
  };
  const segReal = (key: ProgressStageKey) => {
    const e = events.find((x) => stageOfStep(x.step) === key);
    return e ? Date.parse(e.at) - start : null;
  };

  async function act(action: "pause" | "resume" | "cancel" | "retry") {
    setBusy(true);
    try {
      const res = await fetch(`/api/agent/runs/${runId}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error(body.message ?? "That did not work. Try again.");
        return;
      }
      toast.success(action === "pause" ? "Paused" : action === "cancel" ? "Stopped" : "Back on it");
      if (action === "resume" || action === "retry") reconnect();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const playLabel = replaying ? (playing ? "Pause" : (cursor ?? 0) >= span ? "Replay" : "Play") : "Pause";
  const onPlay = () => {
    if (replaying) {
      if ((cursor ?? 0) >= span) setCursor(0);
      setPlaying((p) => !p || (cursor ?? 0) >= span);
      return;
    }
    if (canManage) void act("pause");
  };

  return (
    <div className="cr-root dark flex min-h-screen flex-col bg-[#090B0E] text-[#E7E9EC]">
      <header className="flex flex-wrap items-center gap-3.5 border-b border-[#1A1E23] bg-[#0B0D10] px-4 py-3.5 md:px-8">
        <Link href="/home" className="inline-flex items-center gap-2 text-[13.5px] text-[#C3C8CF] hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> Today
        </Link>
        <span className="h-[22px] w-px bg-[#262B32]" />
        <span className="inline-flex h-[26px] items-center gap-2 rounded-full border border-[#262B32] px-2.5 font-mono text-[11.5px] tracking-[0.12em]">
          <span
            className={cn("size-2 rounded-full", working && !replaying && "cr-pulse")}
            style={{
              background: replaying ? "#818CF8" : working ? (live ? "#C2410C" : "#FBBF24") : "#34D399",
              boxShadow: `0 0 10px ${replaying ? "#818CF8" : working ? "#C2410C" : "#34D399"}`,
            }}
          />
          {replaying ? "REPLAY" : working ? (live ? "LIVE" : "UPDATING") : "DONE"}
        </span>
        <span className="font-display text-[18px] font-bold">Council Room</span>
        <span className="min-w-0 flex-[1_1_200px] truncate text-[13px] text-[#8A9099]">{topic}</span>
        {replaying && (
          <button
            type="button"
            onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)}
            aria-label="Playback speed"
            className="h-9 min-w-12 rounded-[9px] border border-[#262B32] bg-[#14181D] px-2.5 font-mono text-[12.5px]"
          >
            {speed}×
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setCursor(0);
            setPlaying(true);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#262B32] bg-[#14181D] px-3 text-[13px]"
        >
          <RefreshCw className="size-[15px]" aria-hidden /> Replay
        </button>
        {replaying && working && (
          <button type="button" onClick={() => setCursor(null)} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#262B32] bg-[#14181D] px-3 text-[13px]">
            Back to live
          </button>
        )}
        {!replaying && working && canManage && snapshot.status === "PAUSED" ? (
          <button type="button" disabled={busy} onClick={() => void act("resume")} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#F4F5F2] px-3.5 text-[13px] font-semibold text-[#0B0D10]">
            <Play className="size-3.5" aria-hidden /> Carry on
          </button>
        ) : (replaying || (working && canManage)) ? (
          <button type="button" disabled={busy} onClick={onPlay} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#F4F5F2] px-3.5 text-[13px] font-semibold text-[#0B0D10]">
            {playLabel === "Pause" ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />} {playLabel}
          </button>
        ) : snapshot.status === "FAILED" && canManage ? (
          <button type="button" disabled={busy} onClick={() => void act("retry")} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#F4F5F2] px-3.5 text-[13px] font-semibold text-[#0B0D10]">
            Try again
          </button>
        ) : null}
      </header>

      <div className="mx-auto box-border flex w-full max-w-[1480px] flex-col gap-4 px-3 pt-6 pb-12 md:px-6">
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section
            aria-label="The council at work"
            className="relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-[20px] border border-[#1C2026] bg-[#090B0E] bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1.2px)] bg-[length:22px_22px] px-3 py-[18px]"
          >
            <div className="flex justify-center">
            <RoundTable
              seats={seats}
              current={current}
              percent={ready ? 100 : progress.overall.percent}
              stepIndex={stepIndex}
              coreBig={coreBig}
              coreSub={coreSub}
              ready={ready}
              runId={runId}
              selected={selectedKey}
              onSelect={setPicked}
              handoff={handoff}
            />
            </div>
            <div className="mx-3 flex min-h-[52px] items-start gap-3 rounded-[14px] border border-[#22272E] bg-[rgba(16,19,23,0.92)] px-4 py-3.5">
              <span
                className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full font-display text-[13px] font-extrabold text-[#0B0D10]"
                style={{ background: DARK[captionStage] }}
              >
                {captionWho.split(" ").at(-1)?.length === 1 ? captionWho.split(" ").at(-1) : captionWho.charAt(0)}
              </span>
              <p className="m-0 text-[15px] leading-normal text-white md:text-[16px]">
                <strong className="font-bold" style={{ color: DARK[captionStage] }}>
                  {captionWho}
                </strong>{" "}
                <span className={cn(working && !replaying && "cr-caret")}>{captionText}</span>
              </p>
            </div>
          </section>

          <aside className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <section className={cn(PANEL, "flex flex-col gap-3.5 p-[18px]")}>
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[16px] font-bold text-white">Live numbers</span>
                <span className="font-mono text-[12px] text-[#8A9099]">{CORE_TITLE[current]}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-0.5 rounded-xl bg-[#14181D] p-3">
                  <span className="text-[11.5px] text-[#8A9099]">Time</span>
                  <span className="font-mono text-[24px] text-white tabular-nums" suppressHydrationWarning>
                    {mmss(elapsed)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-xl bg-[#14181D] p-3">
                  <span className="text-[11.5px] text-[#8A9099]">Spent of ${(snapshot.maxCents / 100).toFixed(2)}</span>
                  <span className="font-mono text-[24px] text-white tabular-nums">${(snapshot.spentCents / 100).toFixed(2)}</span>
                </div>
              </div>
              {tele.map((m) => (
                <div key={m.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] text-[#C3C8CF]">{m.label}</span>
                    <span className="font-mono text-[15px] text-white">{m.v}</span>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-[#1E2228]">
                    <div className="h-full transition-[width] duration-300" style={{ width: `${m.w}%`, background: m.c }} />
                  </div>
                </div>
              ))}
            </section>
            <section className={cn(PANEL, "flex flex-col gap-2 p-[18px]")}>
              <span className="font-display text-[16px] font-bold text-white">Facts on file</span>
              {claims.length === 0 && <p className="border-t border-[#1C2026] pt-2 text-[13px] text-[#8A9099]">No facts recorded yet.</p>}
              {claims.slice(0, 5).map((c) => (
                <div key={c.id} className="cr-pop flex flex-col gap-0.5 border-t border-[#1C2026] py-2">
                  <span className="text-[13px] leading-snug">{c.statement}</span>
                  <span className={cn("text-[12px] font-semibold", c.status === "SUPPORTED" ? "text-[#34D399]" : c.status === "UNSUPPORTED" ? "text-[#FB7185]" : "text-[#FBBF24]")}>
                    {c.status === "SUPPORTED" ? "Supported" : c.status === "UNSUPPORTED" ? "Not supported" : "Unverified"}
                  </span>
                </div>
              ))}
            </section>
            <section className={cn(PANEL, "flex flex-col gap-2.5 p-[18px]")}>
              <span className="font-display text-[16px] font-bold text-white">AI providers</span>
              {providers.length === 0 && <p className="text-[13px] text-[#8A9099]">No provider set up.</p>}
              {providers.map((p) => {
                const c = p.state === "ok" ? "#34D399" : p.state === "cooling" ? "#FBBF24" : "#FB7185";
                return (
                  <div key={p.provider} className="flex items-center gap-2.5 text-[13px]">
                    <span className="size-2 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                    {providerName(p.provider)}
                    <span className="ml-auto text-[12px]" style={{ color: c }}>
                      {p.state === "ok" ? "Working" : p.state === "cooling" ? `Busy · cooling off` : shortReason(p.reason)}
                    </span>
                  </div>
                );
              })}
            </section>
          </aside>
        </div>

        <section aria-label="Timeline" className={cn(PANEL, "flex flex-col gap-2.5 px-5 pt-4 pb-3.5")}>
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[15px] font-bold text-white">Timeline</span>
            <span className="text-[12px] text-[#8A9099]">{working && !replaying ? "Live — replay any time" : "Click a step to jump to it"}</span>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {segs.map((s) => {
              const c = DARK[s.key];
              const fill = s.state === "done" ? 100 : s.state === "active" ? 55 : 0;
              const at = segStart(s.key);
              const real = segReal(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={at === null}
                  onClick={() => {
                    if (at === null) return;
                    setCursor(at + 1);
                    setPlaying(true);
                  }}
                  aria-label={`Jump to ${s.label}`}
                  className="flex min-w-[90px] flex-1 flex-col gap-2 border-0 bg-transparent p-0 text-left disabled:cursor-default"
                >
                  <span className="block h-2.5 w-full overflow-hidden rounded-[4px] bg-[#1A1E23]">
                    <span className="block h-full transition-[width] duration-300" style={{ width: `${fill}%`, background: c }} />
                  </span>
                  <span className="flex items-baseline gap-1.5 overflow-hidden text-[12px] whitespace-nowrap">
                    <span className="font-semibold" style={{ color: s.state === "active" ? "#FFFFFF" : s.state === "pending" ? "#6B717A" : "#C3C8CF" }}>
                      {CORE_TITLE[s.key]}
                    </span>
                    <span className="font-mono text-[11px] text-[#6B717A]">{real === null ? "" : mmss(real)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section aria-label="Council chatter" className={cn(PANEL, "flex min-h-[360px] min-w-0 flex-col gap-3.5 p-5")}>
            <div className="flex items-center gap-2">
              <span className="font-display text-[17px] font-bold text-white">What they’re saying</span>
              {working && !replaying && <span className="cr-pulse size-1.5 rounded-full bg-[#34D399]" />}
            </div>
            <div className="flex max-h-[420px] min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden">
              {transcript.slice(-6).map((m) => (
                <div key={m.id} className="cr-pop flex items-start gap-2.5">
                  <span
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full font-display text-[12px] font-extrabold text-[#0B0D10]"
                    style={{ background: DARK[m.agent] }}
                  >
                    {m.label ?? AGENTS[m.agent].name.charAt(0)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-bold" style={{ color: DARK[m.agent] }}>
                        {AGENTS[m.agent].name}
                        {m.label ? ` ${m.label}` : ""}
                      </span>
                      <span className="font-mono text-[11px] text-[#6B717A]">{mmss(Date.parse(m.at) - start)}</span>
                    </span>
                    <span className="rounded-[4px_12px_12px_12px] bg-[#171B20] px-3 py-2 text-[13.5px] leading-snug text-[#E7E9EC]">{m.text}</span>
                  </div>
                </div>
              ))}
              {transcript.length === 0 && <p className="text-[13px] text-[#8A9099]">The council is taking its seats.</p>}
            </div>
          </section>

          <FocusPanel seat={selected} board={board} transcript={transcript} claims={claims} runId={runId} ready={ready} />
        </div>
      </div>
    </div>
  );
}

function FocusPanel({
  seat,
  board,
  transcript,
  claims,
  runId,
  ready,
}: {
  seat: Seat;
  board: AgentBoard;
  transcript: TranscriptMessage[];
  claims: CouncilClaim[];
  runId: string;
  ready: boolean;
}) {
  const writersView = seat.stage === "drafting";
  const title = writersView
    ? "The writers’ desk"
    : seat.stage === "research"
      ? "Scout · what it found"
      : seat.stage === "strategy"
        ? "Compass · the angle for each account"
        : seat.stage === "review"
          ? "Lens · checks"
          : seat.stage === "judge"
            ? "Verdict · blind judgement"
            : seat.stage === "adapt"
              ? "Polish · fitting each platform"
              : "Ready for you";
  const failover = board.writers.find((w) => (w.models?.length ?? 0) > 1);
  const lines = transcript.filter((m) => m.agent === seat.stage).slice(-6);

  return (
    <section aria-label={title} className={cn(PANEL, "flex min-w-0 flex-col gap-3.5 p-5 md:px-[22px]")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[18px] font-bold text-white md:text-[20px]">{title}</span>
        <span className="text-[12.5px] text-[#8A9099]">Tap any agent at the table to look inside</span>
      </div>

      {writersView && failover && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-[#5C4A12] bg-[#1F1A0A] px-3.5 py-2.5 text-[13.5px] text-[#FDE68A]">
          <Zap className="size-4 shrink-0" aria-hidden />
          Quill {failover.label} switched to {failover.models?.at(-1)} — nothing lost, no extra wait for you.
        </div>
      )}

      {writersView ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(board.writers.length ? board.writers : (["A", "B", "C"].map((label) => ({ label, state: "pending" }) as AgentSeat))).map((w) => {
            const live = w.state === "active" || w.streaming;
            const switching = (w.models?.length ?? 0) > 1 && w.state === "active";
            const color = switching ? "#FBBF24" : DARK.drafting;
            const n = words(w.draft);
            return (
              <article
                key={w.label}
                className="flex min-h-[240px] flex-col gap-3 rounded-[14px] border p-4"
                style={{ borderColor: live || w.winner ? color : "#262B32", background: "#0E1115" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="inline-flex size-[26px] items-center justify-center rounded-full font-display text-[12px] font-extrabold text-[#0B0D10]" style={{ background: DARK.drafting }}>
                      {w.label}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-[14px] font-bold text-white">Draft {w.label}</span>
                      <span className="font-mono text-[11px] text-[#8A9099]">{w.modelLabel ?? "waiting for a model"}</span>
                    </span>
                  </span>
                  <span className="text-[12.5px] font-semibold" style={{ color: w.winner ? "#34D399" : live ? color : "#8A9099" }}>
                    {w.winner ? "Winner" : switching ? "Switching provider…" : live ? "Writing" : w.state === "done" ? (typeof w.score === "number" ? `${((w.score / JUDGE_MAX) * 10).toFixed(1)} / 10` : "Done") : "Waiting"}
                  </span>
                </div>
                <p className={cn("m-0 flex-1 text-[14px] leading-relaxed whitespace-pre-wrap text-[#E7E9EC]", live && "cr-caret")}>
                  {w.draft ? (w.draft.length > 420 ? `${w.draft.slice(0, 420)}…` : w.draft) : <span className="text-[#6B717A]">Nothing yet.</span>}
                </p>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11px] text-[#8A9099]">{n} words</span>
                  <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-[#1E2228]">
                    <span className="block h-full" style={{ width: `${Math.min(100, (n / 220) * 100)}%`, background: color }} />
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : seat.stage === "judge" ? (
        <div className="grid grid-cols-1 gap-3">
          <div className="grid grid-cols-3 gap-2.5">
            {board.writers.map((w) => (
              <div key={w.label} className={cn("flex flex-col items-center gap-1 rounded-xl p-3", w.winner ? "bg-[#F4F5F2] text-[#0B0D10]" : "bg-[#14181D]")}>
                <span className="font-mono text-[11px] opacity-70">
                  {w.label}
                  {w.winner ? " · winner" : ""}
                </span>
                <span className="font-display text-[26px] font-bold">{typeof w.score === "number" ? ((w.score / JUDGE_MAX) * 10).toFixed(1) : "—"}</span>
              </div>
            ))}
          </div>
          {board.writers.find((w) => w.winner)?.rationale && (
            <p className="text-[14px] leading-relaxed text-[#C3C8CF]">“{board.writers.find((w) => w.winner)?.rationale}”</p>
          )}
          <p className="text-[12.5px] text-[#8A9099]">The judge saw the text only — no model names, no cost.</p>
        </div>
      ) : seat.stage === "research" && claims.length ? (
        <ul className="grid grid-cols-1 gap-0">
          {claims.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 border-t border-[#1C2026] py-2.5 text-[14px]">
              <span className="flex flex-col gap-0.5">
                <span>{c.statement}</span>
                {c.sourceTitle && <span className="text-[12px] text-[#8A9099]">{c.sourceTitle}</span>}
              </span>
              <span className={cn("shrink-0 text-[12px] font-semibold", c.status === "SUPPORTED" ? "text-[#34D399]" : "text-[#FBBF24]")}>
                {c.status === "SUPPORTED" ? "Supported" : "Unverified"}
              </span>
            </li>
          ))}
        </ul>
      ) : seat.key === "you" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[15px] text-[#E7E9EC]">{ready ? "The council is done. Nothing goes out until you approve it." : "Your seat. You decide once the council is finished."}</p>
          {ready && (
            <Link href={`/review/${runId}`} className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-signal px-4 text-[14px] font-semibold !text-white">
              Review &amp; approve <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      ) : lines.length ? (
        <ul className="grid grid-cols-1">
          {lines.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 border-t border-[#1C2026] py-2.5">
              <span className="text-[14px]">{m.text}</span>
              <Attachments output={m.output} animate={false} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-[#8A9099]">{seat.name} hasn’t started yet.</p>
      )}
    </section>
  );
}
