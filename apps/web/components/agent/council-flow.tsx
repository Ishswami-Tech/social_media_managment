"use client";

/**
 * The Agent Council as a relay. Agents are not shown all at once: the ones
 * who have worked sit small on the left, the one working now stands large in
 * the middle with a speech bubble, and only the next in line is hinted at on
 * the right. Each handoff slides the picture along. Framer Motion moves the
 * agents; GSAP drives the dashed lines, the packet and the bubble; a Three.js
 * particle field behind it takes the working agent's colour. Everything is
 * derived from the same `ProgressStage[]` the text views use.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

gsap.registerPlugin(MotionPathPlugin);
import { Check } from "lucide-react";
import { revealStages, type ProgressStage, type ProgressStageKey } from "@platform/agent-council/progress";
import { AGENTS } from "@/components/agent/agents";
import { cn } from "@/lib/utils";

const AmbientCanvas = dynamic(() => import("./ambient-canvas"), { ssr: false });

const WIDTH = 820;
const HEIGHT = 270;
const RADIUS = 30;
const LABEL_MAX_CHARS = 28;
const DONE_LABEL_MAX_CHARS = 18;
/** How big each kind of agent is drawn, relative to RADIUS. */
const SCALE = { active: 1.12, done: 0.78, failed: 1, hint: 0.8 };
/** The speech bubble above the agent at work. */
const BUBBLE = { maxChars: 40, charWidth: 6.1, padding: 18, height: 22, lift: 38 };

interface NodePoint {
  x: number;
  y: number;
}

/** Evenly spaced along the width, lifted into a soft arc like a horizon. */
function arcPoints(count: number): NodePoint[] {
  const margin = 70;
  const usable = WIDTH - margin * 2;
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = margin + usable * t;
    const lift = Math.sin(t * Math.PI);
    return { x, y: 160 - lift * 74 };
  });
}

function segmentPath(a: NodePoint, b: NodePoint): string {
  const dx = (b.x - a.x) / 2;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function truncate(value: string, max: number = LABEL_MAX_CHARS): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Where the bubble sits: above the node, kept inside the picture. */
function bubbleBox(p: NodePoint, text: string): { x: number; y: number; w: number } {
  const w = Math.min(WIDTH - 24, text.length * BUBBLE.charWidth + BUBBLE.padding);
  const x = Math.min(WIDTH - 12 - w, Math.max(12, p.x - w / 2));
  return { x, y: p.y - RADIUS * SCALE.active - BUBBLE.lift - BUBBLE.height, w };
}

const subscribeNever = (): (() => void) => () => {};

export interface CouncilFlowProps {
  stages: ProgressStage[];
  /** True while agents are working; drives the flow speed and the particles. */
  working: boolean;
  /** The model behind each stage, shown under the agent once known. */
  models?: Partial<Record<ProgressStageKey, string>>;
  /** Highlighted agent, and what to do when one is clicked. */
  selected?: ProgressStageKey | null;
  onSelect?: (key: ProgressStageKey) => void;
  className?: string;
}

function fillFor(key: ProgressStageKey, state: ProgressStage["state"], hint: boolean): string {
  if (hint) return "var(--color-card)";
  if (state === "failed") return "url(#council-failed)";
  if (state === "active" || state === "done") return `url(#agent-${key})`;
  return "var(--color-card)";
}

function scaleFor(state: ProgressStage["state"], hint: boolean): number {
  if (hint) return SCALE.hint;
  if (state === "active") return SCALE.active;
  if (state === "failed") return SCALE.failed;
  return SCALE.done;
}

function iconClass(state: ProgressStage["state"], hint: boolean): string {
  if (hint) return "text-muted-foreground/60";
  return state === "pending" || state === "skipped" ? "text-muted-foreground" : "text-white";
}

export function CouncilFlow({ stages, working, models = {}, selected = null, onSelect, className }: CouncilFlowProps) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  // Motion styles differ between server and client, so the picture only draws after mount.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const shown = useMemo(() => revealStages(stages), [stages]);
  // Every agent keeps its own slot on the arc, so the picture fills in from
  // left to right as the work reaches each one.
  const points = useMemo(() => arcPoints(stages.length), [stages.length]);
  const activeIndex = shown.findIndex((s) => !s.hint && s.stage.state === "active");
  const reached = activeIndex >= 0 ? activeIndex : shown.filter((s) => !s.hint).length;
  const activeStage = activeIndex >= 0 ? shown[activeIndex]!.stage : undefined;
  const activePoint = activeIndex >= 0 ? points[activeIndex] : undefined;
  const bubbleText =
    activeStage && activeStage.key !== "ready" ? truncate(activeStage.activity.at(-1) ?? activeStage.label, BUBBLE.maxChars) : undefined;
  const accent = activeStage ? AGENTS[activeStage.key].from : undefined;

  // GSAP: the dashes travel along every segment the work has already crossed;
  // the segment into the active agent draws itself when it becomes active.
  useEffect(() => {
    const root = svg.current;
    if (!root || reduced) return;
    const ctx = gsap.context(() => {
      const flowing = root.querySelectorAll<SVGPathElement>("path[data-flow='true']");
      const drawing = root.querySelectorAll<SVGPathElement>("path[data-draw='true']");
      gsap.to(flowing, { strokeDashoffset: -28, duration: working ? 1.1 : 3, ease: "none", repeat: -1 });
      drawing.forEach((path) => {
        const length = path.getTotalLength();
        gsap.fromTo(path, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.9, ease: "power2.out" });
      });
      // A packet rides the last flowing segment toward the agent at work.
      const packet = root.querySelector<SVGCircleElement>("circle[data-packet='true']");
      const lane = drawing[0] ?? flowing[flowing.length - 1];
      if (packet && lane && working) {
        gsap.set(packet, { opacity: 1 });
        gsap.to(packet, { motionPath: { path: lane, align: lane, alignOrigin: [0.5, 0.5] }, duration: 1.8, repeat: -1, ease: "power1.inOut" });
      } else if (packet) {
        gsap.set(packet, { opacity: 0 });
      }
    }, root);
    return () => ctx.revert();
  }, [reached, shown.length, working, reduced, mounted]);

  // GSAP: each new line the working agent says pops up in its bubble.
  useEffect(() => {
    const root = svg.current;
    if (!root || reduced || !bubbleText) return;
    const bubble = root.querySelector<SVGGElement>("g[data-bubble='true']");
    if (!bubble) return;
    const tween = gsap.fromTo(
      bubble,
      { opacity: 0, y: 8, scale: 0.85, transformOrigin: "50% 100%" },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.8)" },
    );
    return () => {
      tween.kill();
    };
  }, [bubbleText, activeIndex, reduced, mounted]);

  const frame = cn(
    "relative overflow-hidden rounded-2xl border border-white/60 bg-white/55 shadow-[0_20px_60px_-30px_rgba(80,60,200,0.35)] backdrop-blur-xl",
    "dark:border-white/10 dark:bg-white/[0.04]",
    className,
  );

  if (!mounted) return <div className={cn(frame, "aspect-[820/270] w-full")} aria-hidden />;

  return (
    <div className={frame}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklch,var(--brand)_18%,transparent),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:18px_18px]"
      />
      <AmbientCanvas active={working} accent={accent} className="pointer-events-none absolute inset-0 opacity-60" />
      <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="relative w-full" role="img" aria-label="Agents working on this post">
        <defs>
          {stages.map((s) => (
            <linearGradient key={s.key} id={`agent-${s.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={AGENTS[s.key].from} />
              <stop offset="100%" stopColor={AGENTS[s.key].to} />
            </linearGradient>
          ))}
          <linearGradient id="council-failed" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
          <linearGradient id="council-path" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
          <filter id="council-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {points.slice(0, Math.max(0, shown.length - 1)).map((a, i) => {
          const b = points[i + 1]!;
          const crossed = i < reached;
          const drawing = i === reached - 1 && activeIndex >= 0;
          const intoHint = shown[i + 1]?.hint === true;
          return (
            <motion.path
              key={`seg-${shown[i]!.stage.key}`}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: intoHint ? 0.45 : 1 }}
              transition={{ duration: 0.5 }}
              d={segmentPath(a, b)}
              fill="none"
              strokeWidth={crossed ? 2.5 : 1.75}
              strokeDasharray="7 7"
              strokeLinecap="round"
              stroke={crossed ? "url(#council-path)" : undefined}
              data-flow={crossed && !drawing ? "true" : undefined}
              data-draw={drawing ? "true" : undefined}
              className={cn(!crossed && "stroke-border")}
            />
          );
        })}
        <circle data-packet="true" r={5} fill="url(#council-path)" opacity={0} filter="url(#council-glow)" />

        {shown.map(({ stage, hint }, i) => {
          const p = points[i]!;
          const identity = AGENTS[stage.key];
          const Icon = identity.icon;
          const last = stage.activity.at(-1);
          const isActive = !hint && stage.state === "active";
          const scale = scaleFor(stage.state, hint);
          const caption = hint
            ? "up next"
            : truncate(
                models[stage.key] && stage.state !== "pending" ? `${models[stage.key]} · ${last ?? stage.label}` : (last ?? stage.label),
                isActive ? LABEL_MAX_CHARS : DONE_LABEL_MAX_CHARS,
              );
          return (
            <motion.g
              key={stage.key}
              initial={reduced ? false : { x: p.x, y: p.y + 18, opacity: 0 }}
              animate={{ x: p.x, y: p.y, opacity: hint ? 0.5 : 1 }}
              transition={{ type: "spring", stiffness: 170, damping: 22 }}
              role={onSelect && !hint ? "button" : undefined}
              tabIndex={onSelect && !hint ? 0 : undefined}
              aria-pressed={onSelect && !hint ? selected === stage.key : undefined}
              aria-label={`${identity.name}, ${identity.role}: ${hint ? "up next" : (last ?? stage.label)}`}
              onClick={onSelect && !hint ? () => onSelect(stage.key) : undefined}
              onKeyDown={onSelect && !hint ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(stage.key); } } : undefined}
              className={cn(onSelect && !hint && "cursor-pointer outline-none", selected === stage.key && "[&_circle]:drop-shadow-[0_0_10px_color-mix(in_oklch,var(--brand)_60%,transparent)]")}
            >
              <motion.g animate={{ scale }} transition={{ type: "spring", stiffness: 200, damping: 20 }}>
                <text y={-RADIUS - 14} textAnchor="middle" className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {identity.role}
                </text>
                {isActive && !reduced && (
                  <>
                    <circle r={RADIUS + 6} fill={`url(#agent-${stage.key})`} opacity={0.35} filter="url(#council-glow)" />
                    <motion.circle
                      r={RADIUS}
                      fill="none"
                      strokeWidth={1.5}
                      stroke={identity.to}
                      initial={{ scale: 1, opacity: 0.7 }}
                      animate={{ scale: 1.8, opacity: 0 }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                    />
                  </>
                )}
                <motion.circle
                  r={RADIUS}
                  strokeWidth={hint ? 1.5 : 1.5}
                  strokeDasharray={hint ? "4 4" : undefined}
                  fill={fillFor(stage.key, stage.state, hint)}
                  stroke={hint ? "var(--color-border)" : stage.state === "failed" ? "#f43f5e" : identity.to}
                  className="drop-shadow-sm"
                  animate={isActive && !reduced ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                  transition={isActive ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
                />
                <foreignObject x={-13} y={-13} width={26} height={26} className="pointer-events-none">
                  <Icon className={cn("size-[26px]", iconClass(stage.state, hint))} strokeWidth={1.75} aria-hidden />
                </foreignObject>
                {stage.state === "done" && !hint && (
                  <motion.g initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} style={{ transformOrigin: "21px -21px" }}>
                    <circle cx={21} cy={-21} r={9} className="fill-emerald-500 stroke-background" strokeWidth={2} />
                    <foreignObject x={15} y={-27} width={12} height={12} className="pointer-events-none">
                      <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
                    </foreignObject>
                  </motion.g>
                )}
              </motion.g>
              <text y={RADIUS * scale + 20} textAnchor="middle" className={cn("fill-foreground font-semibold", isActive ? "text-[14px]" : "text-[12.5px]")}>
                {identity.name}
              </text>
              <text y={RADIUS * scale + 36} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {caption}
              </text>
            </motion.g>
          );
        })}

        {bubbleText && activePoint && activeStage && (
          <g data-bubble="true" className="pointer-events-none" aria-hidden>
            {(() => {
              const box = bubbleBox(activePoint, bubbleText);
              const color = AGENTS[activeStage.key].from;
              return (
                <>
                  <rect x={box.x} y={box.y} width={box.w} height={BUBBLE.height} rx={BUBBLE.height / 2} fill={color} opacity={0.92} />
                  <path
                    d={`M ${activePoint.x - 5} ${box.y + BUBBLE.height} L ${activePoint.x} ${box.y + BUBBLE.height + 6} L ${activePoint.x + 5} ${box.y + BUBBLE.height} Z`}
                    fill={color}
                    opacity={0.92}
                  />
                  <text x={box.x + box.w / 2} y={box.y + BUBBLE.height / 2 + 4} textAnchor="middle" className="fill-white text-[11px] font-medium">
                    {bubbleText}
                  </text>
                </>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
