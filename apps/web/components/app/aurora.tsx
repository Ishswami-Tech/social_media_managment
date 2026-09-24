"use client";

/**
 * A slow aurora behind the app: three blurred colour fields drifting on
 * their own rhythms. Pure decoration, never captures input, still under
 * prefers-reduced-motion.
 */
import { motion, useReducedMotion } from "framer-motion";

const BLOBS = [
  { className: "left-[-10%] top-[-20%] size-[55vw] bg-brand/25", x: [0, 60, -30, 0], y: [0, 40, 20, 0], duration: 38 },
  { className: "right-[-15%] top-[10%] size-[45vw] bg-brand-2/20", x: [0, -50, 30, 0], y: [0, 30, -40, 0], duration: 46 },
  { className: "left-[30%] bottom-[-30%] size-[50vw] bg-sky-400/15", x: [0, 40, -40, 0], y: [0, -30, 20, 0], duration: 52 },
] as const;

export function Aurora() {
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {BLOBS.map((blob, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full blur-3xl ${blob.className}`}
          animate={reduced ? undefined : { x: [...blob.x], y: [...blob.y] }}
          transition={{ duration: blob.duration, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_40%,var(--background)_85%)]" />
    </div>
  );
}
