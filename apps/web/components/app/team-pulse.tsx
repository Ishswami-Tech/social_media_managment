"use client";

/**
 * The team in the corner of every page: one disc per agent, pulsing while
 * that agent is on a campaign, with a line saying what is happening. Polls
 * the team endpoint, so it stays true whichever page is open.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { TeamSnapshot } from "@/lib/agent/team";
import { AGENTS } from "@/components/agent/agents";
import { cn } from "@/lib/utils";

const REFRESH_MS = 8_000;
const subscribeNever = (): (() => void) => () => {};

export function TeamPulse() {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [team, setTeam] = useState<TeamSnapshot | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/agent/team", { headers: { accept: "application/json" } });
        if (!res.ok) return;
        const next = (await res.json()) as TeamSnapshot;
        if (!stopped) setTeam(next);
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const members = team?.members.filter((m) => m.key !== "ready") ?? [];
  const busy = members.filter((m) => m.working);
  const line = !team
    ? "Checking on the team…"
    : busy.length === 0
      ? "Everyone is standing by"
      : busy.length === 1
        ? `${AGENTS[busy[0]!.key].name} is on “${busy[0]!.working!.topic}”`
        : `${busy.map((m) => AGENTS[m.key].name).join(", ")} are working`;

  return (
    <Link
      href="/agents"
      className="grid gap-2 rounded-xl border bg-card px-3 py-2.5 text-xs transition hover:bg-accent"
      aria-label={`Your agents: ${line}`}
    >
      <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Your agents
        {team && team.live > 0 && (
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-brand">
            <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden /> live
          </span>
        )}
      </span>
      <span className="flex items-center -space-x-1.5">
        {(members.length ? members : Object.keys(AGENTS).filter((k) => k !== "ready").map((key) => ({ key: key as keyof typeof AGENTS, working: null }))).map((m) => {
          const identity = AGENTS[m.key];
          const Icon = identity.icon;
          const working = m.working !== null;
          return (
            <span key={m.key} className="relative" title={`${identity.name} · ${working ? "on duty" : "standing by"}`}>
              {working && mounted && !reduced && (
                <motion.span
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
                  animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  aria-hidden
                />
              )}
              <span
                className={cn("relative inline-flex size-6 items-center justify-center rounded-full text-white ring-2 ring-card", !working && team && "opacity-60")}
                style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
                aria-hidden
              >
                <Icon className="size-3" />
              </span>
            </span>
          );
        })}
      </span>
      <span className="line-clamp-2 leading-snug text-muted-foreground">{line}</span>
    </Link>
  );
}
