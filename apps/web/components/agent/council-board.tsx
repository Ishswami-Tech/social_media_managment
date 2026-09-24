"use client";

/**
 * The live board under the arc: every writer as its own card with the model
 * that is writing, its draft typing in the moment it lands, then the
 * platform reviewer's verdict and the blind judge's score animating onto it.
 * The other seats sit in a strip above. Everything is derived from the same
 * events the text rows use.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Award, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { WRITER_LANES, type AgentBoard, type AgentSeat } from "@platform/agent-council/progress";
import { AGENTS, stageOfSeat } from "@/components/agent/agents";
import { cn } from "@/lib/utils";

const JUDGE_MAX = 60;
const TYPE_CHARS_PER_TICK = 6;
const TYPE_TICK_MS = 18;

/** Reveals text a few characters at a time when it first arrives; instant under reduced motion or on later renders. */
function useTypewriter(text: string | undefined, enabled: boolean): string {
  const [typed, setTyped] = useState<{ source: string; count: number }>({ source: "", count: 0 });
  useEffect(() => {
    if (!text || !enabled) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += TYPE_CHARS_PER_TICK;
      setTyped({ source: text, count: i });
      if (i >= text.length) window.clearInterval(id);
    }, TYPE_TICK_MS);
    return () => window.clearInterval(id);
  }, [text, enabled]);
  if (!text) return "";
  if (!enabled) return text;
  return typed.source === text ? text.slice(0, typed.count) : "";
}

function ModelChip({ seat }: { seat: AgentSeat }) {
  if (!seat.modelLabel) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
      <Sparkles className="size-3" aria-hidden /> {seat.modelLabel}
    </span>
  );
}

function StateDot({ state }: { state: AgentSeat["state"] }) {
  if (state === "active") return <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden />;
  return (
    <span
      className={cn(
        "size-2 rounded-full",
        state === "done" && "bg-emerald-500",
        state === "failed" && "bg-destructive",
        (state === "pending" || state === "skipped") && "bg-muted-foreground/40",
      )}
      aria-hidden
    />
  );
}

function WriterCard({ seat, animate }: { seat: AgentSeat; animate: boolean }) {
  const reduced = useReducedMotion();
  const draft = useTypewriter(seat.draft, animate && !reduced);
  const scorePct = seat.score !== undefined ? Math.round((seat.score / JUDGE_MAX) * 100) : undefined;
  const identity = AGENTS.drafting;
  const Icon = identity.icon;
  return (
    <motion.article
      layout
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative grid content-start gap-2 rounded-xl border bg-white/60 p-3 text-sm backdrop-blur-xl dark:bg-white/[0.04]",
        seat.winner ? "border-emerald-500/60 shadow-[0_0_0_3px_color-mix(in_oklch,#10b981_18%,transparent)]" : "border-white/60 dark:border-white/10",
      )}
    >
      {seat.winner && (
        <motion.span
          initial={reduced ? false : { scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="absolute -right-2 -top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow"
        >
          <Award className="size-3" aria-hidden /> Judge&rsquo;s pick
        </motion.span>
      )}
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex size-6 items-center justify-center rounded-full text-white shadow-sm"
          style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
          aria-hidden
        >
          <Icon className="size-3.5" />
        </span>
        <span className="font-semibold">
          {identity.name} {seat.label}
        </span>
        {seat.label && WRITER_LANES[seat.label] && (
          <span
            className="rounded-full border border-white/60 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:border-white/10"
            title={WRITER_LANES[seat.label]!.brief}
          >
            {WRITER_LANES[seat.label]!.name} lane
          </span>
        )}
        <StateDot state={seat.state} />
        <ModelChip seat={seat} />
        <span className="ml-auto text-[11px] text-muted-foreground">{seat.detail}</span>
      </header>
      {draft ? (
        <p className="max-h-40 overflow-hidden whitespace-pre-wrap text-[13px] leading-snug text-foreground/90 [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
          {draft}
          {seat.state === "active" && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" aria-hidden />}
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {seat.state === "active" ? "Writing…" : seat.state === "pending" ? "Waiting for the strategy" : "No text"}
        </p>
      )}
      <AnimatePresence>
        {seat.reviewVerdict && (
          <motion.p
            key="review"
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden />
            Reviewer: {seat.reviewVerdict === "PASS" ? "reads well" : `${seat.reviewIssues ?? 0} notes, fixed`}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {scorePct !== undefined && (
          <motion.div key="score" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Judge</span>
              <span className="font-medium text-foreground">
                {seat.score}/{JUDGE_MAX}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn("h-full rounded-full", seat.winner ? "bg-gradient-to-r from-emerald-500 to-teal-500" : "bg-gradient-to-r from-brand to-brand-2")}
                initial={reduced ? { width: `${scorePct}%` } : { width: 0 }}
                animate={{ width: `${scorePct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            {seat.rationale && <p className="text-[11px] text-muted-foreground">{seat.rationale}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

export function CouncilBoard({ board, working }: { board: AgentBoard; working: boolean }) {
  const columns = Math.min(3, Math.max(1, board.writers.length));
  return (
    <div className="grid gap-3">
      <ul className="flex flex-wrap gap-2">
        {board.seats.map((seat) => {
          const identity = AGENTS[stageOfSeat(seat.role)];
          const Icon = identity.icon;
          return (
          <li
            key={seat.role}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs backdrop-blur-xl",
              seat.state === "active" ? "border-transparent shadow-sm" : "border-white/60 bg-white/50 dark:border-white/10 dark:bg-white/[0.04]",
            )}
            style={seat.state === "active" ? { backgroundImage: `linear-gradient(135deg, ${identity.from}22, ${identity.to}22)` } : undefined}
            title={`${identity.role}: ${seat.detail}`}
          >
            <span
              className="inline-flex size-5 items-center justify-center rounded-full text-white"
              style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
              aria-hidden
            >
              <Icon className="size-3" />
            </span>
            <StateDot state={seat.state} />
            <span className="font-medium">{identity.name}</span>
            <span className="text-muted-foreground">{identity.role}</span>
            {seat.modelLabel && <span className="text-muted-foreground">· {seat.modelLabel}</span>}
            {seat.state === "active" && seat.detail && <span className="max-w-[16rem] truncate text-muted-foreground">· {seat.detail}</span>}
          </li>
          );
        })}
      </ul>
      {board.writers.length > 0 && (
        <div className={cn("grid gap-3", columns === 2 && "md:grid-cols-2", columns >= 3 && "md:grid-cols-3")}>
          {board.writers.map((w) => (
            <WriterCard key={w.label} seat={w} animate={working} />
          ))}
        </div>
      )}
    </div>
  );
}
