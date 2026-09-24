"use client";

/** A number that counts up to its value on first paint; instant under reduced motion. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "framer-motion";

const DURATION_MS = 700;
const subscribeNever = (): (() => void) => () => {};

export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  // The server prints the final value; the count-up only runs once the browser has taken over.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduced || value === 0) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <span className={className}>{!mounted || reduced || value === 0 ? value : shown}</span>;
}
