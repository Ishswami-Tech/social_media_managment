"use client";

/** Every page in the signed-in app rises in on navigation; still under reduced motion. */
import { useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";

const subscribeNever = (): (() => void) => () => {};

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  // Server and first client paint render plain markup so hydration never sees a motion style it did not send.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (!mounted || reduced) return <>{children}</>;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}
