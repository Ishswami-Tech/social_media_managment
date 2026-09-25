"use client";

/**
 * The team page: every agent as a standing member of staff. Each card shows
 * whether the agent is on a campaign right now, which models it has been
 * using, its numbers for the week, and its last action. Underneath, one
 * stream of everything the team has said across all campaigns. Refreshes
 * itself every few seconds, so the page is alive while work is happening.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, Clock, Radio, Sparkles } from "lucide-react";
import { formatDuration, type ProgressStageKey } from "@platform/agent-council/progress";
import type { ActivityItem, TeamMember, TeamSnapshot } from "@/lib/agent/team";
import { AGENTS } from "@/components/agent/agents";
import { CountUp } from "@/components/ui/count-up";
import { cn } from "@/lib/utils";

const REFRESH_MS = 5_000;
const subscribeNever = (): (() => void) => () => {};

const WHAT_THEY_DO: Record<ProgressStageKey, string> = {
  research: "Reads sources and records the facts every post is built on.",
  strategy: "Picks the angle, the hook and the goal for each account.",
  drafting: "Three writers on different models, each in a different lane.",
  review: "Checks every draft against the platform's rules and fixes what fails.",
  judge: "Scores the drafts blind and picks the winner.",
  adapt: "Fits the winner to the platform and runs the final check.",
  ready: "That is you. Approve, pick a time, or send it back.",
};

function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${formatDuration(ms)} ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function Disc({ agent, working, animate, size = "size-11" }: { agent: ProgressStageKey; working: boolean; animate: boolean; size?: string }) {
  const identity = AGENTS[agent];
  const Icon = identity.icon;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", size)}>
      {working && animate && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
          animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          aria-hidden
        />
      )}
      <span
        className="relative inline-flex size-full items-center justify-center rounded-full text-white shadow-sm"
        style={{ backgroundImage: `linear-gradient(135deg, ${identity.from}, ${identity.to})` }}
        aria-hidden
      >
        <Icon className="size-[45%]" strokeWidth={1.75} />
      </span>
    </span>
  );
}

function MemberCard({ member, animate }: { member: TeamMember; animate: boolean }) {
  const identity = AGENTS[member.key];
  const working = member.working !== null;
  return (
    <motion.article
      layout={animate}
      className={cn(
        "grid gap-3 rounded-2xl border bg-card p-4 transition",
        working && "border-transparent shadow-[0_0_0_2px_color-mix(in_oklch,var(--brand)_45%,transparent)]",
      )}
      style={working ? { backgroundImage: `linear-gradient(135deg, ${identity.from}14, ${identity.to}0a)` } : undefined}
    >
      <header className="flex items-start gap-3">
        <Disc agent={member.key} working={working} animate={animate} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <h3 className="text-base font-semibold">{identity.name}</h3>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{identity.role}</span>
          </div>
          <p className="text-xs text-muted-foreground">{WHAT_THEY_DO[member.key]}</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", working ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
          {working ? "On duty" : "Standing by"}
        </span>
      </header>

      {member.working && (
        <Link href={`/review/${member.working.runId}`} className="rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-sm hover:bg-brand/10">
          <span className="block text-[10px] uppercase tracking-wide text-brand">Working on</span>
          <span className="line-clamp-1 font-medium">{member.working.topic}</span>
          <span className="text-xs text-muted-foreground">for {ago(member.working.since).replace(" ago", "")}</span>
        </Link>
      )}

      {member.key !== "ready" && (
        <dl className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-muted/60 px-2 py-1.5">
            <dt className="text-muted-foreground">Campaigns</dt>
            <dd className="text-base font-semibold tabular-nums">
              <CountUp value={member.runs} />
            </dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-2 py-1.5">
            <dt className="text-muted-foreground">Calls</dt>
            <dd className="text-base font-semibold tabular-nums">
              <CountUp value={member.calls} />
            </dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-2 py-1.5">
            <dt className="text-muted-foreground">Avg time</dt>
            <dd className="text-base font-semibold tabular-nums">{member.avgLatencyMs ? formatDuration(member.avgLatencyMs) : "—"}</dd>
          </div>
        </dl>
      )}

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {member.models.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" aria-hidden /> {member.models.join(", ")}
          </span>
        )}
        {member.failures > 0 && <span className="text-destructive">{member.failures} failed calls</span>}
        {member.key !== "ready" && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden /> {ago(member.lastActive)}
          </span>
        )}
      </footer>
    </motion.article>
  );
}

function ActivityRow({ item, animate }: { item: ActivityItem; animate: boolean }) {
  const identity = AGENTS[item.agent];
  return (
    <motion.li
      layout={animate}
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 py-2"
    >
      <Disc agent={item.agent} working={false} animate={false} size="size-7" />
      <div className="min-w-0 flex-1 text-sm">
        <span className={cn("font-semibold", identity.text)}>
          {identity.name}
          {item.label ? ` ${item.label}` : ""}
        </span>{" "}
        <span className={cn(item.tone === "failed" && "text-destructive")}>{item.text}</span>
        <div className="truncate text-[11px] text-muted-foreground">
          <Link href={`/review/${item.runId}`} className="underline-offset-4 hover:underline">
            {item.topic}
          </Link>
          {" · "}
          {ago(item.at)}
        </div>
      </div>
    </motion.li>
  );
}

export function TeamBoard({ initial }: { initial: TeamSnapshot }) {
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const animate = mounted && !reduced;
  const [snapshot, setSnapshot] = useState(initial);

  // Fresh numbers every few seconds; a failed fetch keeps the last good ones.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/agent/team", { headers: { accept: "application/json" } });
        if (res.ok) {
          const next = (await res.json()) as TeamSnapshot;
          if (!stopped) setSnapshot(next);
        }
      } catch {
        // Offline for a moment; try again on the next tick.
      }
    };
    const id = window.setInterval(() => void tick(), REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const onDuty = snapshot.members.filter((m) => m.working).length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Radio className={cn("size-4", snapshot.live > 0 && "text-brand")} aria-hidden />
          {snapshot.live > 0 ? `${snapshot.live} campaign${snapshot.live === 1 ? "" : "s"} in progress` : "No campaign in progress"}
        </span>
        <span>· {onDuty} on duty</span>
        <span>· numbers are for the last 7 days</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.members.map((member) => (
          <MemberCard key={member.key} member={member} animate={animate} />
        ))}
      </div>

      <section className="rounded-2xl border bg-card p-4" aria-label="Team activity">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-brand" aria-hidden /> Activity across campaigns
        </h2>
        {snapshot.activity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet. Start a post on Home and the team gets to work.</p>
        ) : (
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {snapshot.activity.map((item) => (
                <ActivityRow key={item.id} item={item} animate={animate} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
}
