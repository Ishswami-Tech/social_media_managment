"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 10_000;

/** Keeps the page in step with work happening in the background. Renders nothing. */
export function RefreshTimer({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => router.refresh(), INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, router]);
  return null;
}
