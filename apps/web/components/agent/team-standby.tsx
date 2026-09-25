"use client";

/** The seven agents in a row, breathing gently, waiting for a brief. */
import { motion, useReducedMotion } from "framer-motion";
import { PROGRESS_STAGE_KEYS } from "@platform/agent-council/progress";
import { AGENTS } from "@/components/agent/agents";

export function TeamStandby() {
  const reduced = useReducedMotion();
  return (
    <ul className="flex flex-wrap items-end gap-4" aria-label="Your agents">
      {PROGRESS_STAGE_KEYS.map((key, i) => {
        const identity = AGENTS[key];
        const Icon = identity.icon;
        return (
          <li key={key} className="grid justify-items-center gap-1 text-center">
            <motion.span
              className="inline-flex size-12 items-center justify-center rounded-full text-white shadow-md"
              style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
              animate={reduced ? undefined : { y: [0, -4, 0] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.25 }}
              aria-hidden
            >
              <Icon className="size-5" strokeWidth={1.75} />
            </motion.span>
            <span className="text-xs font-medium">{identity.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{identity.role}</span>
          </li>
        );
      })}
    </ul>
  );
}
