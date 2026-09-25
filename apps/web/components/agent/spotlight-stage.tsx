"use client";

/**
 * The run as a film: one agent fills the stage at a time. Its name in large
 * type, what it is doing as a headline that types itself, and its live output
 * streaming underneath while the model is still talking. A handoff is a light
 * sweep and a camera move; the agent that finished shrinks into the trail at
 * the bottom and the next one rises in. Solid dark stage, no glass. The
 * Three.js field behind it takes the agent's colour; GSAP moves the camera and
 * the light; Framer Motion carries the agents in and out.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { Check, ChevronRight, Sparkles, Wrench } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";
import { formatCents } from "@/components/agent/format";
import {
  formatDuration,
  revealStages,
  stageOfStep,
  type AgentSeat,
  type ProgressStage,
  type ProgressStageKey,
} from "@platform/agent-council/progress";
import type { LivePartial } from "@platform/agent-council/live";
import { AGENTS } from "@/components/agent/agents";
import { cn } from "@/lib/utils";

const AmbientCanvas = dynamic(() => import("./ambient-canvas"), { ssr: false });

const TYPE_CHARS_PER_SECOND = 45;
const subscribeNever = (): (() => void) => () => {};
const CAMERA = { duration: 0.9, ease: "power3.out" } as const;

export interface SpotlightStageProps {
  stages: ProgressStage[];
  working: boolean;
  /** The model behind each stage, shown as a chip once known. */
  models?: Partial<Record<ProgressStageKey, string>> | undefined;
  /** Text still arriving from writers, by step. */
  partials?: Record<string, LivePartial> | undefined;
  /** Writer seats, so a finished draft shows on stage before the next handoff. */
  writers?: AgentSeat[] | undefined;
  /** When the work began; drives the clock in the corner. */
  startedAt?: string | null | undefined;
  /** Running totals for the strip under the header. */
  stats?: { facts?: number; drafts?: number; notesFixed?: number; spentCents?: number } | undefined;
  className?: string;
}

/** Which live entries belong to the agent on stage: its text so far, and the tools it reached for. */
function liveFor(partials: Record<string, LivePartial> | undefined, key: ProgressStageKey): { text?: LivePartial; tools: LivePartial[] } {
  const mine = Object.values(partials ?? {}).filter((p) => stageOfStep(p.step.split("#")[0] ?? p.step) === key);
  const text = mine.filter((p) => p.kind !== "tool").sort((a, b) => b.chars - a.chars)[0];
  const tools = mine.filter((p) => p.kind === "tool").sort((a, b) => a.step.localeCompare(b.step, undefined, { numeric: true })).slice(-4);
  return { text, tools };
}

/** The agent in the spotlight: the one working, else the last one that did anything. */
function spotlightOf(stages: readonly ProgressStage[]): ProgressStage {
  const active = stages.find((s) => s.state === "active");
  if (active) return active;
  const touched = stages.filter((s) => s.state !== "pending");
  return touched[touched.length - 1] ?? stages[0]!;
}

/** Types a line out when it changes after mount; the first line shows at once so the server's markup matches. */
function useTyped(text: string, enabled: boolean): string {
  const [shown, setShown] = useState(text);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === null || !enabled) {
      previous.current = text;
      setShown(text);
      return;
    }
    if (previous.current === text) return;
    previous.current = text;
    let count = 0;
    setShown("");
    const id = window.setInterval(() => {
      count += 1;
      setShown(text.slice(0, count));
      if (count >= text.length) window.clearInterval(id);
    }, 1000 / TYPE_CHARS_PER_SECOND);
    return () => window.clearInterval(id);
  }, [text, enabled]);
  return shown;
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

function Disc({ agent, size, glow, animate }: { agent: ProgressStageKey; size: string; glow?: boolean; animate: boolean }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", size)}>
      {glow && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})`, filter: "blur(18px)" }}
          animate={animate ? { scale: [1, 1.25, 1], opacity: [0.55, 0.9, 0.55] } : { scale: 1.1, opacity: 0.6 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      )}
      <span
        className="relative inline-flex size-full items-center justify-center rounded-full text-white shadow-2xl"
        style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
        aria-hidden
      >
        <Icon className="size-[45%]" strokeWidth={1.6} />
      </span>
    </span>
  );
}

export function SpotlightStage({ stages, working, models = {}, partials, writers = [], startedAt, stats, className }: SpotlightStageProps) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const animate = mounted && !reduced;
  const stageRef = useRef<HTMLElement>(null);

  const spot = useMemo(() => spotlightOf(stages), [stages]);
  const identity = AGENTS[spot.key];
  const index = stages.findIndex((s) => s.key === spot.key);
  const shown = useMemo(() => revealStages(stages), [stages]);
  const trail = shown.filter((s) => !s.hint && s.stage.key !== spot.key && stages.indexOf(s.stage) < index);
  const next = shown.find((s) => s.hint)?.stage;
  const headline = useTyped(spot.activity.at(-1) ?? spot.label, animate);
  const elapsedMs = useElapsed(startedAt, working);
  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  const percent = Math.round((done / stages.length) * 100);

  const { text: live, tools } = liveFor(partials, spot.key);
  const landed = spot.key === "drafting" ? writers.filter((w) => w.draft && !w.streaming).at(-1) : undefined;
  const earlier = spot.activity.slice(0, -1).slice(-3);
  const handedOver = trail[trail.length - 1]?.stage;
  const counters = [
    { label: "facts", value: stats?.facts },
    { label: "drafts", value: stats?.drafts },
    { label: "notes fixed", value: stats?.notesFixed },
  ].filter((c): c is { label: string; value: number } => typeof c.value === "number" && c.value > 0);

  // GSAP: a handoff is a light sweep across the stage and a small camera move.
  useEffect(() => {
    const root = stageRef.current;
    if (!root || !animate) return;
    const sweep = root.querySelector<HTMLElement>("[data-sweep]");
    const content = root.querySelector<HTMLElement>("[data-content]");
    const glow = root.querySelector<HTMLElement>("[data-glow]");
    const tl = gsap.timeline();
    if (sweep) tl.fromTo(sweep, { xPercent: -130, opacity: 0.6 }, { xPercent: 130, opacity: 0, duration: 1.1, ease: "power2.inOut" }, 0);
    if (content) tl.fromTo(content, { x: 40, scale: 1.03 }, { x: 0, scale: 1, duration: CAMERA.duration, ease: CAMERA.ease }, 0);
    if (glow) tl.to(glow, { "--spot": identity.from, duration: 1, ease: "power2.inOut" } as gsap.TweenVars, 0);
    return () => {
      tl.kill();
    };
  }, [spot.key, identity.from, animate]);

  return (
    <section
      ref={stageRef}
      aria-label="Agents working on this post"
      className={cn("relative isolate grid min-h-[27rem] overflow-hidden rounded-3xl bg-[#0b0a14] text-white", className)}
    >
      <AmbientCanvas active={working} accent={identity.from} className="pointer-events-none absolute inset-0 opacity-80" />
      <div
        data-glow
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{ "--spot": identity.from, background: "radial-gradient(circle at 50% 38%, var(--spot) 0%, transparent 55%)" } as React.CSSProperties}
      />
      <div
        data-sweep
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0"
      />

      <div className="relative z-10 grid grid-rows-[auto_1fr_auto] gap-4 p-5 sm:p-6">
        <header className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-white/60">
          <span className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", working ? "animate-pulse bg-emerald-400" : "bg-white/40")} aria-hidden />
            {working ? "Live" : "Finished"}
            {elapsedMs !== null && <span className="tabular-nums text-white/80">· {formatDuration(elapsedMs)}</span>}
          </span>
          <span className="flex items-center gap-3">
            {models[spot.key] && (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-white/80">
                <Sparkles className="size-3" aria-hidden /> {models[spot.key]}
              </span>
            )}
            <span className="tabular-nums">
              {index + 1} / {stages.length}
            </span>
          </span>
        </header>

        {(counters.length > 0 || (stats?.spentCents ?? 0) > 0) && (
          <ul className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/55" aria-label="Running totals">
            {counters.map((c) => (
              <li key={c.label} className="tabular-nums">
                <CountUp value={c.value} className="font-semibold text-white/85" /> {c.label}
              </li>
            ))}
            {(stats?.spentCents ?? 0) > 0 && <li className="tabular-nums">{formatCents(stats!.spentCents!)} spent</li>}
          </ul>
        )}

        <div data-content className="grid place-items-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={spot.key}
              initial={animate ? { opacity: 0, y: 36, scale: 0.94, filter: "blur(14px)" } : false}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={animate ? { opacity: 0, x: -90, scale: 0.9, filter: "blur(10px)" } : undefined}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="grid w-full max-w-2xl justify-items-center gap-3 text-center"
            >
              <Disc agent={spot.key} size="size-24 sm:size-28" glow animate={animate && working} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">{identity.role}</span>
              <h3 className="text-4xl font-semibold tracking-tight sm:text-5xl">{identity.name}</h3>
              <p className={cn("min-h-[1.75rem] text-base text-white/85 sm:text-lg", spot.state === "failed" && "text-rose-300")} aria-live="polite">
                {headline}
                {working && spot.state === "active" && <span className="ml-1 inline-block h-5 w-[3px] animate-pulse bg-white/80 align-middle" aria-hidden />}
              </p>

              {handedOver && working && (
                <motion.p
                  key={handedOver.key}
                  initial={animate ? { opacity: 0, y: -6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/60"
                >
                  <Disc agent={handedOver.key} size="size-4" animate={false} />
                  <span className="truncate">
                    {AGENTS[handedOver.key].name} handed over · {handedOver.activity.at(-1) ?? handedOver.label}
                  </span>
                </motion.p>
              )}

              {tools.length > 0 && (
                <ul className="grid w-full gap-1 text-left text-[12px] text-white/70" aria-label="Tools in use">
                  <AnimatePresence initial={false}>
                    {tools.map((t) => (
                      <motion.li
                        key={t.step}
                        initial={animate ? { opacity: 0, x: -10 } : false}
                        animate={{ opacity: 1, x: 0 }}
                        exit={animate ? { opacity: 0 } : undefined}
                        className="flex items-center gap-2 rounded-lg bg-black/35 px-3 py-1.5"
                      >
                        <Wrench className="size-3.5 shrink-0 text-white/50" aria-hidden />
                        <span className="font-medium text-white/85">{t.tool}</span>
                        {t.text && <span className="truncate italic text-white/60">{t.text}</span>}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}

              {live ? (
                <div className="mt-1 w-full rounded-2xl bg-black/40 px-5 py-4 text-left">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/50">
                    {live.label ? `Quill ${live.label} · writing` : `${identity.name} · thinking`} · {live.text.length} characters
                  </span>
                  <p className="max-h-40 overflow-hidden whitespace-pre-wrap text-[15px] leading-relaxed text-white/90 [mask-image:linear-gradient(to_bottom,black_65%,transparent)]">
                    {live.text || (live.chars > 0 ? "Thinking…" : "Starting…")}
                    <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-white/80 align-middle" aria-hidden />
                  </p>
                </div>
              ) : landed?.draft ? (
                <div className="mt-1 w-full rounded-2xl bg-black/40 px-5 py-4 text-left">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-white/50">
                    Quill {landed.label} · draft ready
                  </span>
                  <p className="max-h-32 overflow-hidden whitespace-pre-wrap text-[15px] leading-relaxed text-white/90 [mask-image:linear-gradient(to_bottom,black_65%,transparent)]">
                    {landed.draft}
                  </p>
                </div>
              ) : earlier.length > 0 ? (
                <ul className="grid gap-0.5 text-[13px] text-white/45">
                  {earlier.map((line, i) => (
                    <motion.li
                      key={`${line}-${i}`}
                      initial={animate ? { opacity: 0, y: 6 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08 }}
                    >
                      {line}
                    </motion.li>
                  ))}
                </ul>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <ul className="flex items-center gap-2" aria-label="Agents who have finished">
              <AnimatePresence initial={false}>
                {trail.map(({ stage }) => (
                  <motion.li
                    key={stage.key}
                    layout={animate}
                    initial={animate ? { scale: 0, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    className="relative"
                    title={`${AGENTS[stage.key].name} · ${stage.activity.at(-1) ?? stage.label}`}
                  >
                    <Disc agent={stage.key} size="size-8" animate={false} />
                    <span
                      className={cn(
                        "absolute -right-1 -top-1 inline-flex size-4 items-center justify-center rounded-full ring-2 ring-[#0b0a14]",
                        stage.state === "failed" ? "bg-rose-500" : "bg-emerald-500",
                      )}
                      aria-hidden
                    >
                      <Check className="size-2.5 text-white" strokeWidth={3} />
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
              {trail.length > 0 && <ChevronRight className="size-4 text-white/30" aria-hidden />}
              <li className="text-[12px] text-white/70">
                {spot.key === "ready" ? (
                  <span className="font-medium text-white">Your turn</span>
                ) : (
                  <>
                    <span className="font-medium text-white">{identity.name}</span>{" "}
                    {working && spot.state === "active" ? "is on it" : spot.state === "failed" ? "could not finish" : "is done"}
                  </>
                )}
              </li>
            </ul>
            {next && (
              <motion.span
                key={next.key}
                initial={animate ? { opacity: 0, x: 12 } : false}
                animate={{ opacity: 1, x: 0 }}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60"
              >
                Next <Disc agent={next.key} size="size-4" animate={false} /> {AGENTS[next.key].name}
              </motion.span>
            )}
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundImage: `linear-gradient(90deg, ${identity.from}, ${identity.to})` }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </footer>
      </div>
    </section>
  );
}
