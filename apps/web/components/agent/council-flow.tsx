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
const HEIGHT = 250;
const RADIUS = 27;
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

const STATE_CLASS: Record<ProgressStage["state"], string> = {
  pending: "fill-muted stroke-border",
  active: "fill-primary/15 stroke-primary",
  done: "fill-emerald-500/15 stroke-emerald-500",
  failed: "fill-destructive/15 stroke-destructive",
  skipped: "fill-muted stroke-border",
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
    return { x, y: 150 - lift * 70 };
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
      gsap.to(flowing, { strokeDashoffset: -24, duration: working ? 1.2 : 3, ease: "none", repeat: -1 });
      drawing.forEach((path) => {
        const length = path.getTotalLength();
        gsap.fromTo(path, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.9, ease: "power2.out" });
      });
    }, root);
    return () => ctx.revert();
  }, [reached, working, reduced, mounted]);

  if (!mounted) {
    return <div className={cn("aspect-[820/250] w-full rounded-xl border bg-gradient-to-b from-primary/5 to-transparent", className)} aria-hidden />;
  }

  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-gradient-to-b from-primary/5 to-transparent", className)}>
      <AmbientCanvas active={working} className="pointer-events-none absolute inset-0 opacity-70" />
      <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="relative w-full" role="img" aria-label="Agents working on this post">
        {points.slice(0, -1).map((a, i) => {
          const b = points[i + 1]!;
          const crossed = i < reached;
          const drawing = i === reached - 1 && activeIndex >= 0;
          return (
            <path
              key={`seg-${i}`}
              d={segmentPath(a, b)}
              fill="none"
              strokeWidth={2}
              strokeDasharray="6 6"
              strokeLinecap="round"
              data-flow={crossed && !drawing ? "true" : undefined}
              data-draw={drawing ? "true" : undefined}
              className={cn(crossed ? "stroke-primary/70" : "stroke-border")}
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
              <text x={p.x} y={p.y - RADIUS - 14} textAnchor="middle" className="fill-muted-foreground text-[10px] uppercase tracking-wide">
                Agent {i + 1}
              </text>
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={RADIUS}
                strokeWidth={1.5}
                className={cn("transition-colors", STATE_CLASS[stage.state])}
                animate={isActive && !reduced ? { scale: [1, 1.07, 1] } : { scale: 1 }}
                transition={isActive ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
                style={{ transformOrigin: `${p.x}px ${p.y}px` }}
              />
              {isActive && !reduced && (
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={RADIUS}
                  fill="none"
                  strokeWidth={1.5}
                  className="stroke-primary"
                  initial={{ scale: 1, opacity: 0.6 }}
                  animate={{ scale: 1.7, opacity: 0 }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                />
              )}
              <foreignObject x={p.x - 12} y={p.y - 12} width={24} height={24} className="pointer-events-none">
                <Icon
                  className={cn(
                    "size-6",
                    stage.state === "active" && "text-primary",
                    stage.state === "done" && "text-emerald-600",
                    stage.state === "failed" && "text-destructive",
                    (stage.state === "pending" || stage.state === "skipped") && "text-muted-foreground",
                  )}
                  aria-hidden
                />
              </foreignObject>
              {stage.state === "done" && (
                <motion.g initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }} style={{ transformOrigin: `${p.x + 19}px ${p.y - 19}px` }}>
                  <circle cx={p.x + 19} cy={p.y - 19} r={8} className="fill-emerald-500" />
                  <foreignObject x={p.x + 13} y={p.y - 25} width={12} height={12} className="pointer-events-none">
                    <Check className="size-3 text-white" aria-hidden />
                  </foreignObject>
                </motion.g>
              )}
              <text x={p.x} y={p.y + RADIUS + 18} textAnchor="middle" className="fill-foreground text-[13px] font-medium">
                {AGENT_NAMES[stage.key]}
              </text>
              <text x={p.x} y={p.y + RADIUS + 34} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {truncate(last ?? stage.label)}
              </text>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
