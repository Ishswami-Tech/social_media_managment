"use client";

/** Every page in the signed-in app rises in on navigation; still under reduced motion. */
import { motion, useReducedMotion } from "framer-motion";

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}
