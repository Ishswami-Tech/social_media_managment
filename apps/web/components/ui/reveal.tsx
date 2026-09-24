"use client";

/**
 * Entrance motion for lists and cards: a soft rise-and-fade, staggered by
 * index, once per element. Static under prefers-reduced-motion.
 */
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const STAGGER_S = 0.05;
const MAX_DELAY_S = 0.4;

export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, delay: Math.min(MAX_DELAY_S, index * STAGGER_S), ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
