"use client";

/**
 * The Agent Council as people picture it: one agent per stage on a gentle
 * arc, joined by a dashed path that flows toward whoever is working now.
 * Framer Motion handles entrances and the pulse of the active agent; GSAP
 * drives the dashed line; a Three.js particle field drifts behind it all.
 * Everything here is derived from the same `ProgressStage[]` the text view
 * uses, so the picture and the words never disagree.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { BookOpenText, Check, Compass, Gavel, PenLine, ScanSearch, Send, Wand2, type LucideIcon } from "lucide-react";
import type { ProgressStage, ProgressStageKey } from "@platform/agent-council/progress";
import { cn } from "@/lib/utils";

const AmbientCanvas = dynamic(() => import("./ambient-canvas"), { ssr: false });

const WIDTH = 820;
const HEIGHT = 270;
const RADIUS = 30;
const LABEL_MAX_CHARS = 34;

const AGENT_NAMES: Record<ProgressStageKey, string> = {
  research: "Researcher",
  strategy: "Strategist",
  drafting: "Writers",
  review: "Reviewer",
  judge: "Judge",
  adapt: "Editor",
  ready: "You",
};

const AGENT_ICONS: Record<ProgressStageKey, LucideIcon> = {
  research: ScanSearch,
  strategy: Compass,
  drafting: PenLine,
  review: BookOpenText,
  judge: Gavel,
  adapt: Wand2,
  ready: Send,
};

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

function truncate(value: string): string {
  return value.length > LABEL_MAX_CHARS ? `${value.slice(0, LABEL_MAX_CHARS - 1)}…` : value;
}

const subscribeNever = (): (() => void) => () => {};

export interface CouncilFlowProps {
  stages: ProgressStage[];
  /** True while agents are working; drives the flow speed and the particles. */
  working: boolean;
  className?: string;
}

function fillFor(state: ProgressStage["state"]): string {
  switch (state) {
    case "active":
      return "url(#council-active)";
    case "done":
      return "url(#council-done)";
    case "failed":
      return "url(#council-failed)";
    default:
      return "var(--color-card)";
  }
}

function strokeClass(state: ProgressStage["state"]): string {
  switch (state) {
    case "active":
      return "stroke-brand";
    case "done":
      return "stroke-emerald-500";
    case "failed":
      return "stroke-destructive";
    default:
      return "stroke-border";
  }
}

function iconClass(state: ProgressStage["state"]): string {
  return state === "pending" || state === "skipped" ? "text-muted-foreground" : "text-white";
}

export function CouncilFlow({ stages, working, className }: CouncilFlowProps) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  // Motion styles differ between server and client, so the picture only draws after mount.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const points = useMemo(() => arcPoints(stages.length), [stages.length]);
  const activeIndex = stages.findIndex((s) => s.state === "active");
  const reached = activeIndex >= 0 ? activeIndex : stages.filter((s) => s.state === "done" || s.state === "skipped").length;

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
    }, root);
    return () => ctx.revert();
  }, [reached, working, reduced, mounted]);

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
      <AmbientCanvas active={working} className="pointer-events-none absolute inset-0 opacity-60" />
      <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="relative w-full" role="img" aria-label="Agents working on this post">
        <defs>
          <linearGradient id="council-active" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
          <linearGradient id="council-done" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#0ea5a5" />
          </linearGradient>
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
        {points.slice(0, -1).map((a, i) => {
          const b = points[i + 1]!;
          const crossed = i < reached;
          const drawing = i === reached - 1 && activeIndex >= 0;
          return (
            <path
              key={`seg-${i}`}
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
        {stages.map((stage, i) => {
          const p = points[i]!;
          const Icon = AGENT_ICONS[stage.key];
          const last = stage.activity.at(-1);
          const isActive = stage.state === "active";
          return (
            <motion.g
              key={stage.key}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : i * 0.06, duration: 0.4 }}
            >
              <text
                x={p.x}
                y={p.y - RADIUS - 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-[0.18em]"
              >
                Agent {i + 1}
              </text>
              {isActive && !reduced && (
                <>
                  <circle cx={p.x} cy={p.y} r={RADIUS + 6} fill="url(#council-active)" opacity={0.35} filter="url(#council-glow)" />
                  <motion.circle
                    cx={p.x}
                    cy={p.y}
                    r={RADIUS}
                    fill="none"
                    strokeWidth={1.5}
                    className="stroke-brand"
                    initial={{ scale: 1, opacity: 0.7 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                    style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                  />
                </>
              )}
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={RADIUS}
                strokeWidth={1.5}
                fill={fillFor(stage.state)}
                className={cn("drop-shadow-sm transition-colors", strokeClass(stage.state))}
                animate={isActive && !reduced ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                transition={isActive ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
                style={{ transformOrigin: `${p.x}px ${p.y}px` }}
              />
              <foreignObject x={p.x - 13} y={p.y - 13} width={26} height={26} className="pointer-events-none">
                <Icon className={cn("size-[26px]", iconClass(stage.state))} strokeWidth={1.75} aria-hidden />
              </foreignObject>
              {stage.state === "done" && (
                <motion.g
                  initial={reduced ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  style={{ transformOrigin: `${p.x + 21}px ${p.y - 21}px` }}
                >
                  <circle cx={p.x + 21} cy={p.y - 21} r={9} className="fill-emerald-500 stroke-background" strokeWidth={2} />
                  <foreignObject x={p.x + 15} y={p.y - 27} width={12} height={12} className="pointer-events-none">
                    <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
                  </foreignObject>
                </motion.g>
              )}
              <text x={p.x} y={p.y + RADIUS + 20} textAnchor="middle" className="fill-foreground text-[13.5px] font-semibold">
                {AGENT_NAMES[stage.key]}
              </text>
              <text x={p.x} y={p.y + RADIUS + 36} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {truncate(last ?? stage.label)}
              </text>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
