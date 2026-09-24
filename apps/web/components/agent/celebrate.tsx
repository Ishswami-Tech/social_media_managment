"use client";

/** A short burst of confetti-like particles when a post is approved. Renders nothing under reduced motion. */
import { motion, useReducedMotion } from "framer-motion";

const COUNT = 18;
const COLORS = ["var(--brand)", "var(--brand-2)", "#10b981", "#f59e0b", "#0ea5e9"];

export function Celebrate({ token }: { token: number }) {
  const reduced = useReducedMotion();
  if (reduced || token === 0) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: COUNT }, (_, i) => {
        const angle = (i / COUNT) * Math.PI * 2;
        const distance = 60 + (i % 3) * 22;
        return (
          <motion.span
            key={`${token}-${i}`}
            className="absolute left-1/2 top-1/2 block size-2 rounded-sm"
            style={{ background: COLORS[i % COLORS.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance + 30, opacity: 0, scale: 0.4, rotate: 180 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}
