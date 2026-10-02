"use client";

/**
 * The pieces of Today, laid out as in the design: the top row, the greeting,
 * the numbers strip, next steps, the next seven days, results, what the
 * council learned, the activity log and the right-hand rail.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Inbox,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ActivityEntry,
  ActivityKind,
  AttentionItem,
  InboxPreview,
  Learning,
  PlanGlance,
  QueueRow,
  SetupStep,
  SpendBreakdown,
  TodayResults,
  UpcomingPost,
  WeekDay,
  WeekItemKind,
} from "@/lib/home/overview";
import { platformName, providerName, shortReason } from "@platform/agent-council/progress";
import type { ProviderStatus } from "@/components/home/provider-strip";
import { PlatformIcon } from "@/components/app/platform-icon";
import { AGENTS } from "@/components/agent/agents";
import { fillComposer } from "@/components/home/composer-bar";
import { ViewModeToggle } from "@/components/home/thread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, compactNumber, dayLabel, timeLabel, truncate } from "@/lib/utils";
import { useViewMode } from "@/hooks/use-view-mode";

export interface TodayStats {
  awaiting: number;
  publishedThisMonth: number;
  /** ISO timestamp of the next scheduled publish, or null. */
  nextScheduledAt: string | null;
  /** Best-performing post this month, if analytics exist. */
  topReach: { impressions: number; postId: string } | null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const fmt = compactNumber;

function timeOf(iso: string, timeZone: string): string {
  return timeLabel(iso, timeZone);
}

/** "Fri 2 Oct · 10:30" in the organization's zone. */
export function stamp(iso: string, timeZone: string): string {
  return `${dayLabel(iso, timeZone)} · ${timeLabel(iso, timeZone)}`;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, message: data.message };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

export const CARD = "rounded-[14px] border border-border bg-card";

/** Section title row: 20px display heading, optional right-hand link or note. */
export function SectionHead({
  title,
  href,
  linkLabel,
  note,
  id,
  action,
  count,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  note?: React.ReactNode;
  id?: string;
  action?: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="min-w-0 font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">
        {title}
        {count !== undefined && count > 0 && <span className="sr-only"> ({count})</span>}
      </h2>
      <div className="flex items-center gap-3">
        {note && <span className="text-[13px] whitespace-nowrap text-muted-foreground">{note}</span>}
        {href && (
          <Link href={href} className="text-[13px] text-foreground underline underline-offset-2 hover:text-muted-foreground">
            {linkLabel ?? "See all"}
          </Link>
        )}
        {action}
      </div>
    </div>
  );
}

/** A thin progress bar. */
export function Meter({ value, className, tone = "ink", height = 6 }: { value: number; className?: string; tone?: "ink" | "signal" | "compass"; height?: number }) {
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-[#E6E8E3] dark:bg-white/10", className)} style={{ height }}>
      <div
        className={cn("h-full rounded-full", tone === "signal" ? "bg-signal" : tone === "compass" ? "bg-agent-compass" : "bg-foreground")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top row: search, Simple/Detailed, help, notifications
// ---------------------------------------------------------------------------

export interface Command {
  label: string;
  href: string;
  hint?: string;
}

const COMMANDS: Command[] = [
  { label: "New post", href: "/home#compose", hint: "N" },
  { label: "Today", href: "/home" },
  { label: "Plan", href: "/plan" },
  { label: "Posts", href: "/posts" },
  { label: "Posts waiting for review", href: "/posts?filter=review" },
  { label: "Calendar", href: "/posts?view=calendar" },
  { label: "Inbox", href: "/whatsapp/inbox" },
  { label: "Results", href: "/analytics" },
  { label: "Memory", href: "/memory" },
  { label: "Accounts", href: "/accounts" },
  { label: "Settings", href: "/settings" },
];

function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? COMMANDS.filter((c) => c.label.toLowerCase().includes(needle)) : COMMANDS;
  }, [q]);

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-[42px] max-w-[520px] min-w-0 flex-[1_1_320px] items-center gap-2.5 rounded-[11px] border border-input bg-card px-3 text-left text-[14px] text-muted-foreground transition-colors hover:border-foreground/30"
        >
          <Search className="size-[17px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Search posts, plans, contacts — or type a command</span>
          <kbd className="rounded-[5px] border border-input bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">⌘K</kbd>
        </button>
      </DialogTrigger>
      <DialogContent className="top-[20%] translate-y-0 grid-cols-1 gap-0 overflow-hidden rounded-[14px] p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const first = matches[0];
            if (first && q.trim() && first.label.toLowerCase().includes(q.trim().toLowerCase())) go(first.href);
            else if (q.trim()) go(`/posts?q=${encodeURIComponent(q.trim())}`);
          }}
          className="flex items-center gap-2.5 border-b border-border px-4"
        >
          <Search className="size-[17px] text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search posts, plans, contacts — or type a command"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            aria-label="Search"
          />
        </form>
        <ul className="max-h-80 overflow-y-auto p-2">
          {q.trim() && (
            <li>
              <button type="button" onClick={() => go(`/posts?q=${encodeURIComponent(q.trim())}`)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-accent">
                <Search className="size-4 text-muted-foreground" aria-hidden /> Search posts for “{q.trim()}”
              </button>
            </li>
          )}
          {matches.map((c) => (
            <li key={c.href + c.label}>
              <button type="button" onClick={() => go(c.href)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[14px] hover:bg-accent">
                <span>{c.label}</span>
                {c.hint && <kbd className="rounded border border-input bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">{c.hint}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function HelpButton() {
  const steps: { key: keyof typeof AGENTS; text: string }[] = [
    { key: "research", text: "reads up on your topic and records every fact with its source" },
    { key: "strategy", text: "picks the angle for each account from what has worked before" },
    { key: "drafting", text: "three writers on three different models each draft a version" },
    { key: "review", text: "checks each draft for facts, length, links and platform rules" },
    { key: "judge", text: "scores the drafts blind — no model names, no cost" },
    { key: "adapt", text: "fits the winner to each platform and adds an image" },
    { key: "ready", text: "you approve. Nothing goes out without you" },
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" aria-label="Help and shortcuts" className="size-[42px] shrink-0 rounded-[11px] border border-border bg-card text-[16px] font-bold hover:bg-accent">
          ?
        </button>
      </DialogTrigger>
      <HowCouncilWorks steps={steps} />
    </Dialog>
  );
}

function HowCouncilWorks({ steps }: { steps: { key: keyof typeof AGENTS; text: string }[] }) {
  return (
    <DialogContent className="grid-cols-1 rounded-[14px] sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display text-[20px] font-bold">How the council works</DialogTitle>
        <DialogDescription>Seven seats, one post. You only see it when it is ready for you.</DialogDescription>
      </DialogHeader>
      <ol className="grid grid-cols-1 gap-3">
        {steps.map((s) => {
          const a = AGENTS[s.key];
          return (
            <li key={s.key} className="flex items-start gap-3">
              <AgentDot agent={s.key} size={28} />
              <p className="text-[14px] leading-snug">
                <span className="font-semibold">{a.name}</span> <span className="text-muted-foreground">({a.role.toLowerCase()})</span> {s.text}.
              </p>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
        <span>
          <kbd className="rounded border border-input bg-muted px-1.5 font-mono">⌘K</kbd> search &amp; commands
        </span>
      </div>
    </DialogContent>
  );
}

/** A solid agent disc with its initial, in the agent's own colour. */
export function AgentDot({ agent, size = 34, label, className }: { agent: keyof typeof AGENTS; size?: number; label?: string; className?: string }) {
  const a = AGENTS[agent];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white dark:text-[#111316]", className)}
      style={{ width: size, height: size, background: a.from, fontSize: Math.round(size * 0.42) }}
    >
      {label ?? a.name.charAt(0)}
    </span>
  );
}

function NotificationsButton({ attention, inbox }: { attention: AttentionItem[]; inbox: InboxPreview[] }) {
  const count = attention.length + inbox.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={count ? `Notifications, ${count} new` : "Notifications"}
          className="relative inline-flex size-[42px] shrink-0 items-center justify-center rounded-[11px] border border-border bg-card hover:bg-accent"
        >
          <Bell className="size-[18px]" aria-hidden />
          {count > 0 && <span className="absolute top-2 right-[9px] size-2 rounded-full bg-signal ring-2 ring-card" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{count ? "Needs you" : "You are all caught up"}</DropdownMenuLabel>
        {attention.map((a) => (
          <DropdownMenuItem key={a.key} asChild>
            <Link href={a.href} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 text-danger" />
              <span className="grid">
                <span className="font-medium">{a.title}</span>
                <span className="text-xs text-muted-foreground">{truncate(a.detail, 70)}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        {inbox.map((c) => (
          <DropdownMenuItem key={c.conversationId} asChild>
            <Link href="/whatsapp/inbox" className="flex items-start gap-2">
              <Inbox className="mt-0.5" />
              <span className="grid">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{truncate(c.preview || "New message", 60)}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TodayTopBar({ attention, inbox }: { attention: AttentionItem[]; inbox: InboxPreview[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <CommandSearch />
      <span className="hidden flex-grow sm:block" />
      <ViewModeToggle />
      <HelpButton />
      <NotificationsButton attention={attention} inbox={inbox} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

export type CouncilHealth = "ok" | "degraded" | "down";

export function TodayHero({
  eyebrow,
  greeting,
  lead,
  rest,
  health,
  healthText,
}: {
  eyebrow: string;
  greeting: string;
  /** The first clause, in the signal colour when something needs the person. */
  lead: string | null;
  rest: string;
  health: CouncilHealth;
  healthText: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="flex min-w-0 flex-[1_1_640px] flex-col gap-2.5">
        <p className="font-mono text-[12px] tracking-[0.06em] text-muted-foreground uppercase">{eyebrow}</p>
        <h1 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.025em] text-balance md:text-[40px]">{greeting}</h1>
        <p className="max-w-[760px] text-[17px] leading-normal text-pretty text-[#2A2E34] md:text-[18px] dark:text-foreground/85">
          {lead && <strong className="text-signal">{lead}</strong>}
          {lead ? ", " : ""}
          {rest}
        </p>
      </div>
      <span
        className={cn(
          "inline-flex h-[34px] items-center gap-2 rounded-full px-3 text-[13px] font-semibold",
          health === "ok" ? "bg-success-soft text-success" : health === "degraded" ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger",
        )}
      >
        <span className={cn("size-2 rounded-full", health === "ok" ? "bg-[#16A34A]" : health === "degraded" ? "bg-amber-500" : "bg-red-500")} />
        {healthText}
      </span>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Numbers at a glance (Detailed)
// ---------------------------------------------------------------------------

export interface KpiTile {
  label: string;
  value: string;
  note: string;
  signal?: boolean;
  href?: string;
}

export function KpiStrip({ tiles }: { tiles: KpiTile[] }) {
  return (
    <section aria-label="Numbers at a glance" className={cn(CARD, "grid grid-cols-2 overflow-hidden sm:grid-cols-3 xl:grid-cols-6")}>
      {tiles.map((t) => {
        const body = (
          <>
            <span className="text-[12.5px] text-muted-foreground">{t.label}</span>
            <span className={cn("font-display text-[26px] leading-tight font-bold tracking-[-0.02em] tabular-nums", t.signal && "text-signal")}>{t.value}</span>
            <span className="truncate font-mono text-[12px] text-muted-foreground">{t.note}</span>
          </>
        );
        const cls = "flex min-w-0 flex-col gap-1 px-[18px] py-4 shadow-[inset_-1px_-1px_0_var(--rule)]";
        return t.href ? (
          <Link key={t.label} href={t.href} className={cn(cls, "hover:bg-accent/50")}>
            {body}
          </Link>
        ) : (
          <div key={t.label} className={cls}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Your next steps
// ---------------------------------------------------------------------------

export type StepIcon = "check" | "link" | "inbox" | "calendar" | "alert" | "sparkle";

export interface NextStep {
  icon: StepIcon;
  tone: "signal" | "warn" | "teal" | "info" | "danger";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

const STEP_ICON: Record<StepIcon, LucideIcon> = {
  check: Check,
  link: Link2,
  inbox: Inbox,
  calendar: CalendarDays,
  alert: AlertTriangle,
  sparkle: Sparkles,
};
const STEP_TONE: Record<NextStep["tone"], string> = {
  signal: "bg-signal-soft text-signal",
  warn: "bg-warn-soft text-warn",
  teal: "bg-[#E1F2EE] text-[#0F7A6C] dark:bg-[#12302b] dark:text-[#5eead4]",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
};

export function NextSteps({ steps }: { steps: NextStep[] }) {
  if (steps.length === 0) return null;
  return (
    <section aria-labelledby="next-h" className="flex flex-col gap-3">
      <SectionHead id="next-h" title="Your next steps" note="In the order that matters most" />
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-3">
        {steps.map((s, i) => {
          const Icon = STEP_ICON[s.icon];
          return (
            <li key={s.title} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2.5">
                <span className={cn("inline-flex size-[34px] items-center justify-center rounded-[10px]", STEP_TONE[s.tone])}>
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="font-mono text-[12px] text-muted-foreground">STEP {i + 1}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{s.title}</span>
                <span className="text-[13px] text-muted-foreground">{s.detail}</span>
              </div>
              <Link href={s.href} className="mt-auto inline-flex items-center gap-1.5 self-start text-[13.5px] font-semibold hover:underline">
                {s.cta} <ArrowRight className="size-[15px]" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Next 7 days
// ---------------------------------------------------------------------------

const KIND_STYLE: Record<WeekItemKind, { cls: string; label: string }> = {
  published: { cls: "bg-success-soft text-success", label: "Published" },
  scheduled: { cls: "bg-foreground text-background", label: "Scheduled" },
  ready: { cls: "bg-signal-soft text-signal-ink", label: "Needs you" },
  writing: { cls: "bg-info-soft text-info", label: "Being written" },
  failed: { cls: "bg-danger-soft text-danger", label: "Didn’t publish" },
};

export function NextSevenDays({ week, timeZone, canCreate }: { week: WeekDay[]; timeZone: string; canCreate: boolean }) {
  return (
    <section aria-labelledby="week-h" className={cn(CARD, "flex flex-col gap-3.5 p-5")}>
      <SectionHead id="week-h" title="Next 7 days" href="/posts?view=calendar" linkLabel="Open calendar" />
      <div className="overflow-x-auto">
        <div className="grid min-w-[620px] grid-cols-7 gap-2">
          {week.map((d, i) => {
            const date = new Date(d.date);
            const today = i === 0;
            return (
              <div
                key={d.date}
                className={cn(
                  "flex min-w-0 flex-col gap-1.5 rounded-[10px] border p-2.5",
                  today ? "border-foreground bg-card" : "border-rule bg-[#F9FAF7] dark:bg-white/[0.02]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11.5px] text-muted-foreground uppercase">
                    {dayLabel(d.date, timeZone).split(" ")[0]}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-[22px] items-center justify-center rounded-full font-mono text-[12px]",
                      today && "bg-signal text-white dark:text-[#14161a]",
                    )}
                  >
                    {dayLabel(d.date, timeZone).split(" ")[1]}
                  </span>
                </div>
                {d.items.slice(0, 3).map((it) => (
                  <Link
                    key={it.key}
                    href={it.href}
                    title={`${KIND_STYLE[it.kind].label}: ${it.title}`}
                    className={cn("flex min-w-0 items-center gap-1.5 rounded-[7px] py-[5px] pr-1.5 pl-1 text-[12px]", KIND_STYLE[it.kind].cls)}
                  >
                    <PlatformIcon platform={it.platform} className="size-[18px] rounded-[5px] text-[8px]" />
                    <span className="truncate">{it.title}</span>
                  </Link>
                ))}
                {d.items.length > 3 && <span className="px-1 text-[11.5px] text-muted-foreground">+{d.items.length - 3} more</span>}
                {d.items.length === 0 && canCreate && (
                  <button
                    type="button"
                    onClick={() => {
                      fillComposer(`A post for ${date.toLocaleDateString("en-US", { weekday: "long", timeZone })}: `);
                      document.getElementById("compose")?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                    className="flex h-[30px] items-center justify-center gap-1 rounded-[7px] border border-dashed border-[#C4C8C1] text-[12px] text-[#454B53] hover:bg-card dark:border-white/20 dark:text-muted-foreground"
                  >
                    <Sparkles className="size-[13px]" aria-hidden /> Fill
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it's going
// ---------------------------------------------------------------------------

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div aria-hidden className="flex h-[34px] items-end gap-[3px]">
      {values.map((v, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-[2px]", i >= values.length - 4 ? "bg-foreground" : "bg-[#D5D8D2] dark:bg-white/15")}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function changeText(change: number | null, fallback: string): { text: string; tone: string } {
  if (change === null) return { text: fallback, tone: "text-muted-foreground" };
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) return { text: "About the same as the 30 days before", tone: "text-muted-foreground" };
  return change > 0
    ? { text: `${pct}% more than the 30 days before`, tone: "text-success" }
    : { text: `${pct}% less than the 30 days before`, tone: "text-warn" };
}

export function HowItsGoing({ results, quietNote }: { results: TodayResults; quietNote: string | null }) {
  const tiles = [
    { label: "People who saw your posts", tile: results.reach },
    { label: "Likes, comments and shares", tile: results.engagement },
    { label: "New WhatsApp contacts", tile: results.contacts },
  ];
  return (
    <section aria-labelledby="results-h" className={cn(CARD, "flex flex-col gap-3.5 p-5")}>
      <SectionHead id="results-h" title="How it’s going · last 30 days" href="/analytics" linkLabel="All results" />
      {results.published === 0 && results.contacts.value === 0 ? (
        <p className="text-[14px] text-muted-foreground">Nothing published in the last 30 days yet. Once posts go out, their reach and replies show up here.</p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-2.5">
            {tiles.map(({ label, tile }) => {
              const c = changeText(tile.change, "First 30 days of numbers");
              return (
                <div key={label} className="flex flex-col gap-2 rounded-xl border border-rule bg-[#F9FAF7] p-4 dark:bg-white/[0.02]">
                  <span className="text-[13px] text-[#454B53] dark:text-muted-foreground">{label}</span>
                  <span className="font-display text-[30px] leading-none font-bold tracking-[-0.02em] tabular-nums">{fmt(tile.value)}</span>
                  <Spark values={tile.spark} />
                  <span className={cn("text-[12.5px] font-semibold", c.tone)}>{c.text}</span>
                </div>
              );
            })}
          </div>
          <ViewSwitch
            simple={
              results.leader ? (
                <p className="text-[14px] leading-normal">
                  {platformName(results.leader.platform)} is doing most of the work —{" "}
                  <strong>about {Math.round(results.leader.share * 100)}% of your reach</strong>.{quietNote ? ` ${quietNote}` : ""}
                </p>
              ) : null
            }
            detailed={
              <>
                {results.accounts.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13.5px]">
                      <thead>
                        <tr className="text-left text-[12px] text-muted-foreground">
                          <th scope="col" className="px-3 py-2 font-semibold">Account</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">Posts</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">Impressions</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">Eng. rate</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">Median / post</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.accounts.map((a) => (
                          <tr key={a.accountId} className="border-t border-rule">
                            <td className="px-3 py-2.5">
                              <span className="flex items-center gap-2">
                                <PlatformIcon platform={a.platform} className="size-5 text-[8px]" />
                                <span className="font-semibold">{a.name}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono">{a.posts}</td>
                            <td className="px-3 py-2.5 text-right font-mono">{fmt(a.impressions)}</td>
                            <td className="px-3 py-2.5 text-right font-mono">{a.engagementRate === null ? "—" : `${(a.engagementRate * 100).toFixed(1)}%`}</td>
                            <td className="px-3 py-2.5 text-right font-mono">{fmt(Math.round(a.median))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <span className="font-mono text-[12px] text-muted-foreground">
                  {results.lastSnapshotAt ? `Snapshots captured ${ago(results.lastSnapshotAt)} ago` : "No snapshots yet"} · Export CSV from Results
                </span>
              </>
            }
          />
        </>
      )}
    </section>
  );
}

/** Picks the Simple or Detailed child, from the remembered view mode. */
export function ViewSwitch({ simple, detailed }: { simple: React.ReactNode; detailed: React.ReactNode }) {
  const { mode } = useViewMode();
  return <>{mode === "detailed" ? detailed : simple}</>;
}

// ---------------------------------------------------------------------------
// What the council learned this week
// ---------------------------------------------------------------------------

export function Learned({ learnings }: { learnings: Learning[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (learnings.length === 0) return null;

  async function forget(l: Learning) {
    if (l.action.kind !== "forget") return;
    setBusy(l.key);
    try {
      const res = await fetch(`/api/accounts/${l.action.accountId}/memory`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forgetPreference: l.action.index }),
      });
      if (!res.ok) throw new Error();
      toast.success("Forgotten. The writers won’t follow that any more.");
      router.refresh();
    } catch {
      toast.error("Could not undo that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="learned-h" className={cn(CARD, "px-5 pt-5 pb-2")}>
      <SectionHead id="learned-h" title="What the council learned this week" href="/memory" linkLabel="Open memory" />
      <ul className="mt-2.5">
        {learnings.map((l) => (
          <li key={l.key} className="flex flex-wrap items-start gap-3.5 border-t border-rule py-3.5">
            <Sparkles className="mt-0.5 size-[18px] text-agent-compass" aria-hidden />
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
              <span className="text-[14.5px] leading-snug">{l.text}</span>
              <ViewSwitch
                simple={null}
                detailed={
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[12px] whitespace-nowrap text-muted-foreground">
                      {l.confidence} · {l.basis}
                    </span>
                    <div className="w-[120px]">
                      <Meter value={l.strength} tone="compass" height={4} />
                    </div>
                  </div>
                }
              />
            </div>
            {l.action.kind === "fill" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (l.action.kind !== "fill") return;
                  fillComposer(l.action.prompt);
                  document.getElementById("compose")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                {l.action.label}
              </Button>
            ) : l.action.kind === "link" ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={l.action.href}>{l.action.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={busy === l.key} onClick={() => void forget(l)}>
                {busy === l.key && <Loader2 className="animate-spin" aria-hidden />}
                {l.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Activity log (Detailed)
// ---------------------------------------------------------------------------

const ACTIVITY_COLOR: Record<ActivityKind, string> = {
  council: "text-agent-compass",
  publish: "text-success",
  webhook: "text-agent-scout",
  whatsapp: "text-[#0F7A6C] dark:text-[#5eead4]",
  learning: "text-agent-quill",
  audit: "text-muted-foreground",
  error: "text-danger",
};
const FILTERS = ["All", "Council", "Publishing", "Webhooks", "WhatsApp", "Errors"] as const;

export function ActivityLog({ entries, timeZone }: { entries: ActivityEntry[]; timeZone: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const shown = entries.filter((e) =>
    filter === "All"
      ? true
      : filter === "Errors"
        ? e.error
        : filter === "Council"
          ? e.kind === "council"
          : filter === "Publishing"
            ? e.kind === "publish"
            : filter === "Webhooks"
              ? e.kind === "webhook"
              : e.kind === "whatsapp",
  );
  return (
    <section aria-labelledby="activity-h" className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <SectionHead id="activity-h" title="Activity log" href="/settings" linkLabel="Audit log" />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-7 rounded-[7px] border px-2.5 text-[12.5px]",
              filter === f ? "border-foreground bg-foreground text-background" : "border-input bg-card hover:bg-accent",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="font-mono text-[12.5px]">
        {shown.length === 0 && <p className="border-t border-rule py-3 text-muted-foreground">Nothing here in the last two days.</p>}
        {shown.map((e) => (
          <div key={e.key} className="grid grid-cols-[64px_80px_minmax(0,1fr)] gap-3 border-t border-rule py-[7px] sm:grid-cols-[76px_90px_minmax(0,1fr)]">
            <span className="text-[#6B717A]">{timeOf(e.at, timeZone)}</span>
            <span className={cn("font-semibold", e.error ? ACTIVITY_COLOR.error : ACTIVITY_COLOR[e.kind])}>{e.kind}</span>
            <span className="truncate">{e.text}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 border-t border-rule pt-2.5 text-[12.5px] text-muted-foreground">
        <span>
          <kbd className="rounded border border-input bg-muted px-1.5 font-mono">⌘K</kbd> search &amp; commands
        </span>
        <span>
          <kbd className="rounded border border-input bg-muted px-1.5 font-mono">N</kbd> new post
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Right rail
// ---------------------------------------------------------------------------

export function AttentionCard({ items, canPublish, canManage }: { items: AttentionItem[]; canPublish: boolean; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;

  async function act(item: AttentionItem) {
    if (!item.action.id) return;
    setBusy(item.key);
    const url = item.action.kind === "retry_post" ? `/api/posts/${item.action.id}/publish` : `/api/agent/runs/${item.action.id}/${item.title.includes("stopped") ? "retry" : "resume"}`;
    const r = await postJson(url);
    setBusy(null);
    if (!r.ok) return toast.error(r.message ?? "That did not work. Try again.");
    toast.success(item.action.kind === "retry_post" ? "Trying again" : "Back on it");
    router.refresh();
  }

  return (
    <section aria-labelledby="attention-h" id="attention" className={cn(CARD, "flex flex-col gap-2.5 border-[#F0C9B6] px-5 pt-5 pb-2 dark:border-signal/30")}>
      <h2 id="attention-h" className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">
        Needs attention
      </h2>
      {items.map((item) => {
        const actionable = item.action.kind === "link" || (item.action.kind === "retry_post" ? canPublish : canManage);
        return (
          <div key={item.key} className="flex gap-3 border-t border-rule py-2.5 last:pb-3.5">
            {item.kind === "failed_post" ? (
              <X className="mt-0.5 size-[18px] shrink-0 text-danger" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-signal-ink" aria-hidden />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[14px] font-semibold">{item.title}</span>
              <span className="text-[13px] leading-snug text-[#454B53] dark:text-muted-foreground">{item.detail}</span>
              <ViewSwitch simple={null} detailed={<span className="font-mono text-[11.5px] break-words text-muted-foreground">{item.technical}</span>} />
              <div>
                {!actionable || item.action.kind === "link" ? (
                  <Button size="sm" variant={item.kind === "account" ? "default" : "outline"} asChild>
                    <Link href={item.href}>{actionable ? item.action.label : "Open"}</Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy === item.key} onClick={() => void act(item)}>
                    {busy === item.key ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                    {item.action.label}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function WhatsAppCard({ items }: { items: InboxPreview[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="wa-h" className={cn(CARD, "px-5 pt-5 pb-2")}>
      <SectionHead id="wa-h" title="WhatsApp" href="/whatsapp/inbox" linkLabel="Open inbox" />
      <ul className="mt-2">
        {items.map((c) => (
          <li key={c.conversationId}>
            <Link href="/whatsapp/inbox" className="flex items-start gap-3 border-t border-rule py-3 hover:opacity-80">
              <span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#DCDFD8] text-[13px] font-bold dark:bg-white/10">
                {c.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex justify-between gap-2">
                  <span className="text-[13.5px] font-semibold">{c.name}</span>
                  <span className="font-mono text-[11.5px] text-muted-foreground">{ago(c.at)}</span>
                </span>
                <span className="text-[13px] leading-snug text-[#454B53] dark:text-muted-foreground">{c.preview || "New message"}</span>
                {c.suggestion && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-signal-ink">
                    <Sparkles className="size-3" aria-hidden /> Suggested reply ready
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GoingOutSoon({ items, awaiting, timeZone }: { items: UpcomingPost[]; awaiting: number; timeZone: string }) {
  return (
    <section aria-labelledby="soon-h" className={cn(CARD, "px-5 pt-5 pb-2")}>
      <SectionHead id="soon-h" title="Going out soon" href="/posts?filter=scheduled" linkLabel="All" />
      <ul className="mt-2">
        {items.length === 0 && <li className="border-t border-rule py-3 text-[13px] text-muted-foreground">Nothing scheduled in the next 7 days.</li>}
        {items.map((p) => (
          <li key={p.postId}>
            <Link href={`/posts/${p.postId}`} className="flex items-start gap-3 border-t border-rule py-3 hover:opacity-80">
              <PlatformIcon platform={p.platforms[0] ?? "LINKEDIN"} className="size-[22px] text-[9px]" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-[12px] text-muted-foreground">{stamp(p.scheduledAt, timeZone)}</span>
                <span className="text-[13.5px] leading-snug">{p.title}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {awaiting > 0 && (
        <p className="border-t border-rule py-3 text-[12.5px] text-muted-foreground">
          {awaiting} more go{awaiting === 1 ? "es" : ""} out once you approve {awaiting === 1 ? "it" : "them"}.
        </p>
      )}
    </section>
  );
}

export function PlanCard({ plan, canStart, timeZone }: { plan: PlanGlance | null; canStart: boolean; timeZone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!plan)
    return (
      <section aria-labelledby="plan-h" className={cn(CARD, "flex flex-col gap-3 p-5")}>
        <SectionHead id="plan-h" title="This month’s plan" href="/plan" linkLabel="Open" />
        <p className="text-[13.5px] text-muted-foreground">Give the council a theme and it drafts a month of ideas you can start with one click.</p>
        <Button size="sm" asChild className="self-start">
          <Link href="/plan">Plan a month</Link>
        </Button>
      </section>
    );

  async function start() {
    if (!plan?.next) return;
    setBusy(true);
    const r = await postJson(`/api/agent/plans/${plan.planId}/start`, { index: plan.next.index });
    setBusy(false);
    if (!r.ok) return toast.error(r.message ?? "Could not start it. Try again.");
    toast.success("Started. The council is on it.");
    router.refresh();
  }

  return (
    <section aria-labelledby="plan-h" className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <SectionHead id="plan-h" title="This month’s plan" href="/plan" linkLabel="Open" />
      <span className="text-[14.5px] font-semibold">{plan.name}</span>
      <div className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
        <Meter value={plan.total ? (plan.started / plan.total) * 100 : 0} />
        <span className="shrink-0">
          {plan.started} of {plan.total} started
        </span>
      </div>
      {plan.next && (
        <div className="flex items-center gap-2.5 rounded-[10px] bg-[#F6F7F4] p-3 dark:bg-white/[0.04]">
          <PlatformIcon platform={plan.next.platform} className="size-[22px] text-[9px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[11.5px] text-muted-foreground uppercase">
              Next idea · {dayLabel(plan.next.date, timeZone)}
            </span>
            <span className="truncate text-[13.5px]">{plan.next.title}</span>
          </span>
          {canStart && (
            <Button size="sm" disabled={busy} onClick={() => void start()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Start
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function SetupCard({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section aria-labelledby="setup-h" className={cn(CARD, "flex flex-col gap-2.5 p-5")}>
      <h2 id="setup-h" className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">
        Get more from the council
      </h2>
      <div className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
        <Meter value={(done / steps.length) * 100} tone="signal" />
        <span className="shrink-0">
          {done} of {steps.length}
        </span>
      </div>
      <ul>
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className={cn("flex items-center gap-2.5 py-2 text-[13.5px] hover:opacity-80", s.done ? "text-muted-foreground" : "")}>
              <span
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                  s.done ? "bg-foreground text-background" : "border-[1.5px] border-[#C4C8C1] dark:border-white/25",
                )}
              >
                {s.done && <Check className="size-3" aria-hidden />}
              </span>
              <span className={s.done ? "line-through" : "font-semibold"}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <TourLink />
    </section>
  );
}

function TourLink() {
  const steps: { key: keyof typeof AGENTS; text: string }[] = [
    { key: "research", text: "reads up on your topic and records every fact with its source" },
    { key: "strategy", text: "picks the angle for each account from what has worked before" },
    { key: "drafting", text: "three writers on three different models each draft a version" },
    { key: "review", text: "checks each draft for facts, length, links and platform rules" },
    { key: "judge", text: "scores the drafts blind — no model names, no cost" },
    { key: "adapt", text: "fits the winner to each platform and adds an image" },
    { key: "ready", text: "you approve. Nothing goes out without you" },
  ];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="flex items-center gap-3 rounded-[10px] bg-[#111316] p-3 text-left text-white hover:bg-[#1d2025]">
          <span className="flex -space-x-1.5">
            <AgentDot agent="research" size={22} className="ring-2 ring-[#111316]" />
            <AgentDot agent="drafting" size={22} label="Q" className="ring-2 ring-[#111316]" />
            <AgentDot agent="judge" size={22} className="ring-2 ring-[#111316]" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-semibold">How the council works</span>
            <span className="text-[12px] text-sidebar-foreground">1-minute tour of the 7 steps</span>
          </span>
        </button>
      </DialogTrigger>
      <HowCouncilWorks steps={steps} />
    </Dialog>
  );
}

export function SystemStatusCard({ providers, queues, at }: { providers: ProviderStatus[]; queues: QueueRow[]; at: string }) {
  return (
    <section aria-labelledby="sys-h" className={cn(CARD, "flex flex-col gap-2.5 p-5")}>
      <SectionHead id="sys-h" title="System status" note={<span className="font-mono text-[11.5px]">live · {at}</span>} />
      <h3 className="text-[13px] font-semibold tracking-[0.01em] text-muted-foreground">AI providers · circuit breaker</h3>
      {providers.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No AI provider is set up yet.</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted-foreground">
              <th scope="col" className="pb-1 font-semibold">Provider</th>
              <th scope="col" className="px-1.5 pb-1 font-semibold">State</th>
              <th scope="col" className="px-1.5 pb-1 text-right font-semibold">avg</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.provider} className="border-t border-rule align-top">
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", p.state === "ok" ? "bg-[#16A34A]" : p.state === "cooling" ? "bg-amber-500" : "bg-red-500")} />
                    {providerName(p.provider)}
                  </span>
                  {p.state !== "ok" && p.reason && <span className="block pl-4 font-mono text-[11px] text-warn">{shortReason(p.reason)}</span>}
                </td>
                <td className={cn("px-1.5 py-2 font-mono", p.state === "ok" ? "text-[#454B53] dark:text-muted-foreground" : "text-warn")}>
                  {p.state === "ok" ? "closed" : p.state === "cooling" ? "open" : "failing"}
                </td>
                <td className="px-1.5 py-2 text-right font-mono">{p.avgLatencyMs ? `${(p.avgLatencyMs / 1000).toFixed(1)} s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="pt-1 text-[13px] font-semibold tracking-[0.01em] text-muted-foreground">Work in progress</h3>
      <div>
        {queues.map((q) => (
          <div key={q.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-rule py-2 text-[12.5px]">
            <span className={cn("font-mono font-semibold", q.bad && "text-danger")}>{q.name}</span>
            <span className="font-mono text-[#454B53] dark:text-muted-foreground">{q.name === "failed jobs" ? "" : `${q.active} active`}</span>
            <span className={cn("font-mono", q.bad ? "text-danger" : "text-muted-foreground")}>{q.waitingLabel}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SpendCard({
  spentCents,
  budgetCents,
  breakdown,
}: {
  spentCents: number;
  budgetCents: number;
  breakdown: SpendBreakdown;
}) {
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  const total = breakdown.stages.reduce((a, s) => a + s.cents, 0);
  return (
    <section aria-labelledby="spend-h" className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <SectionHead
        id="spend-h"
        title={`Spend · ${month.slice(0, 3)}`}
        note={
          <span className="font-mono text-[12px] text-foreground">
            {money(spentCents)} / {money(budgetCents)}
          </span>
        }
      />
      <Meter value={budgetCents ? (spentCents / budgetCents) * 100 : 0} />
      <div className="flex flex-col gap-2">
        {breakdown.stages.map((s) => {
          const pct = total ? Math.round((s.cents / total) * 100) : 0;
          return (
            <div key={s.label} className="grid grid-cols-[100px_1fr_36px] items-center gap-2.5 text-[12.5px]">
              <span className="text-[#454B53] dark:text-muted-foreground">{s.label}</span>
              <Meter value={pct} />
              <span className="text-right font-mono">{pct}%</span>
            </div>
          );
        })}
      </div>
      <h3 className="pt-1 text-[13px] font-semibold tracking-[0.01em] text-muted-foreground">Models today</h3>
      {breakdown.models.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No model calls in the last day.</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] text-muted-foreground">
              <th scope="col" className="pb-1 font-semibold">Model</th>
              <th scope="col" className="px-1.5 pb-1 text-right font-semibold">Calls</th>
              <th scope="col" className="pb-1 text-right font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.models.map((m) => (
              <tr key={m.model} className="border-t border-rule">
                <td className="max-w-[160px] truncate py-[7px] font-mono">{m.model}</td>
                <td className="px-1.5 py-[7px] text-right font-mono">{m.calls}</td>
                <td className="py-[7px] text-right font-mono">{money(m.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
