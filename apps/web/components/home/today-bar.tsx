import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Inbox,
  Plug,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { AttentionItem, InboxPreview, PlanGlance, SetupStep, TodayResults, UpcomingPost, WeekDay } from "@/lib/home/overview";
import { CountUp } from "@/components/ui/count-up";
import { PlatformIcon } from "@/components/app/platform-icon";
import { cn, truncate } from "@/lib/utils";

export interface TodayStats {
  awaiting: number;
  publishedThisMonth: number;
  /** ISO timestamp of the next scheduled publish, or null. */
  nextScheduledAt: string | null;
  /** Best-performing post this month, if analytics exist. */
  topReach: { impressions: number; postId: string } | null;
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** Every date on Today reads in the organization's time zone, not the server's. */
function dayKey(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone });
}

function timeOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

function when(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (dayKey(d, timeZone) === dayKey(today, timeZone)) return `Today ${timeOf(iso, timeZone)}`;
  if (dayKey(d, timeZone) === dayKey(tomorrow, timeZone)) return `Tomorrow ${timeOf(iso, timeZone)}`;
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone });
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

// ---------------------------------------------------------------------------
// Section chrome
// ---------------------------------------------------------------------------

/** Heading row for a Today section: title, optional count, optional link. */
export function SectionHead({
  title,
  count,
  href,
  linkLabel,
  id,
  action,
}: {
  title: string;
  count?: number;
  href?: string;
  linkLabel?: string;
  id?: string;
  /** A button beside the link, e.g. "Approve all". */
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="font-display text-[18px] font-semibold tracking-tight">
        {title}
        {count !== undefined && count > 0 && <span className="ml-2 font-mono text-[13px] font-normal text-muted-foreground tabular">{count}</span>}
      </h2>
      <div className="flex items-center gap-3">
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            {linkLabel ?? "See all"} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
        {action}
      </div>
    </div>
  );
}

/** A card in the right-hand rail. */
export function RailCard({
  title,
  icon: Icon,
  href,
  linkLabel,
  tone,
  children,
}: {
  title: string;
  icon: LucideIcon;
  href?: string;
  linkLabel?: string;
  tone?: "danger" | "signal";
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-5",
        tone === "danger" ? "border-danger/30" : tone === "signal" ? "border-signal/30" : "border-border",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
          <Icon className={cn("size-4", tone === "danger" ? "text-danger" : tone === "signal" ? "text-signal" : "text-muted-foreground")} aria-hidden />
          {title}
        </h3>
        {href && (
          <Link href={href} className="text-[12px] text-muted-foreground hover:text-foreground">
            {linkLabel ?? "Open"}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stat strip (Detailed)
// ---------------------------------------------------------------------------

/** The four numbers that tell you what to do next, straight from the database. */
export function TodayBar({ stats, timeZone }: { stats: TodayStats; timeZone: string }) {
  const tiles = [
    {
      icon: Inbox,
      label: "Waiting for you",
      value: <CountUp value={stats.awaiting} />,
      href: stats.awaiting > 0 ? "#waiting" : undefined,
      tone: stats.awaiting > 0 ? "text-signal" : "text-foreground",
    },
    {
      icon: CheckCircle2,
      label: "Published this month",
      value: <CountUp value={stats.publishedThisMonth} />,
      href: "/posts",
      tone: "text-foreground",
    },
    {
      icon: CalendarClock,
      label: "Next going out",
      value: stats.nextScheduledAt ? when(stats.nextScheduledAt, timeZone) : "Nothing yet",
      href: "/posts",
      tone: "text-foreground",
    },
    {
      icon: TrendingUp,
      label: "Best reach this month",
      value: stats.topReach ? `${fmt(stats.topReach.impressions)} views` : "No results yet",
      href: stats.topReach ? `/posts/${stats.topReach.postId}` : "/analytics",
      tone: "text-foreground",
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Icon className="size-3.5" aria-hidden /> {t.label}
            </span>
            <span className={cn("font-display text-[22px] leading-tight font-semibold tabular-nums", t.tone)}>{t.value}</span>
          </>
        );
        const className = "grid gap-1.5 bg-card px-5 py-4 transition-colors hover:bg-accent/50";
        return t.href ? (
          <Link key={t.label} href={t.href} className={className}>
            {body}
          </Link>
        ) : (
          <div key={t.label} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

export interface NextStep {
  title: string;
  detail: string;
  href: string;
  cta: string;
  tone: "signal" | "danger" | "ink";
}

/** At most three things worth doing now, most urgent first. */
export function NextSteps({ steps }: { steps: NextStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="grid grid-cols-1 gap-2">
      {steps.map((s, i) => (
        <li key={s.title}>
          <Link
            href={s.href}
            className="group flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-input"
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-medium",
                s.tone === "signal" ? "bg-signal-soft text-signal-ink" : s.tone === "danger" ? "bg-danger-soft text-danger" : "bg-muted text-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{s.title}</span>
              <span className="block truncate text-[13px] text-muted-foreground">{s.detail}</span>
            </span>
            <span
              className={cn(
                "hidden shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-medium sm:inline-flex",
                s.tone === "signal" ? "bg-signal text-white dark:text-[#14161a]" : "border border-input group-hover:bg-accent",
              )}
            >
              {s.cta} <ArrowRight className="size-3.5" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/** Seven days from today with how many posts go out on each. */
export function WeekStrip({ week, timeZone }: { week: WeekDay[]; timeZone: string }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {week.map((d, i) => {
        const date = new Date(d.date);
        return (
          <Link
            key={d.date}
            href="/posts?view=calendar"
            className={cn(
              "grid justify-items-center gap-1 rounded-lg border px-1 py-2.5 text-center transition-colors hover:border-input",
              i === 0 ? "border-foreground/20 bg-card" : "border-border bg-card",
            )}
          >
            <span className="text-[11px] text-muted-foreground uppercase">
              {i === 0 ? "Today" : date.toLocaleDateString("en-US", { weekday: "short", timeZone })}
            </span>
            <span className="font-display text-[18px] leading-none font-semibold tabular-nums">
              {date.toLocaleDateString("en-US", { day: "numeric", timeZone })}
            </span>
            <span className="flex h-2 items-center gap-0.5" aria-label={`${d.count} posts`}>
              {Array.from({ length: Math.min(d.count, 4) }, (_, k) => (
                <span key={k} className="size-1.5 rounded-full bg-signal" />
              ))}
              {d.count === 0 && <span className="size-1.5 rounded-full bg-border" />}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail lists
// ---------------------------------------------------------------------------

export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="grid grid-cols-1 gap-1">
      {items.map((item) => (
        <li key={`${item.kind}:${item.href}:${item.title}`}>
          <Link href={item.href} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/60">
            {item.kind === "account" ? (
              <Plug className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium">{truncate(item.title, 60)}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{item.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function InboxList({ items }: { items: InboxPreview[] }) {
  if (items.length === 0) return <p className="text-[13px] text-muted-foreground">No unread chats.</p>;
  return (
    <ul className="grid grid-cols-1 gap-1">
      {items.map((c) => (
        <li key={c.conversationId}>
          <Link
            href="/whatsapp/inbox"
            className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/60"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-[12px] font-medium text-success">
              {c.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[14px] font-medium">{c.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ago(c.at)}</span>
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">{c.preview || "New message"}</span>
            </span>
            <span className="min-w-5 rounded-full bg-signal px-1.5 text-center font-mono text-[11px] leading-5 text-white dark:text-[#14161a]">
              {c.unread}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function UpcomingList({ items, timeZone }: { items: UpcomingPost[]; timeZone: string }) {
  if (items.length === 0)
    return <p className="text-[13px] text-muted-foreground">Nothing scheduled in the next 7 days.</p>;
  return (
    <ul className="grid grid-cols-1 gap-1">
      {items.map((p) => (
        <li key={p.postId}>
          <Link href={`/posts/${p.postId}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/60">
            <span className="w-[72px] shrink-0 font-mono text-[12px] leading-tight text-muted-foreground">
              {dayKey(new Date(p.scheduledAt), timeZone) === dayKey(new Date(), timeZone)
                ? timeOf(p.scheduledAt, timeZone)
                : `${new Date(p.scheduledAt).toLocaleDateString("en-US", { weekday: "short", timeZone })} ${new Date(p.scheduledAt).toLocaleDateString("en-US", { day: "numeric", timeZone })}`}
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px]">{p.title}</span>
            <span className="flex shrink-0 -space-x-1">
              {p.platforms.map((pl) => (
                <PlatformIcon key={pl} platform={pl} className="size-5 text-[8px] ring-2 ring-card" />
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PlanSummary({ plan }: { plan: PlanGlance | null }) {
  if (!plan)
    return (
      <div className="grid gap-3">
        <p className="text-[13px] text-muted-foreground">Give the council a theme and it drafts a month of ideas you can start with one click.</p>
        <Link href="/plan" className="inline-flex w-fit items-center gap-1 text-[13px] font-medium hover:underline">
          Plan a month <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    );
  const pct = plan.total > 0 ? Math.round((plan.started / plan.total) * 100) : 0;
  return (
    <div className="grid gap-2">
      <p className="truncate text-[14px] font-medium">{plan.name}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <p className="font-mono text-[12px] text-muted-foreground tabular">
        {plan.started} of {plan.total} started · {plan.remaining} still to come
      </p>
    </div>
  );
}

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-signal" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <span className="font-mono text-[12px] text-muted-foreground tabular">
          {done}/{steps.length}
        </span>
      </div>
      <ul className="grid gap-0.5">
        {steps.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={cn(
                "-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px] hover:bg-accent/60",
                s.done && "text-muted-foreground line-through decoration-border",
              )}
            >
              <span
                className={cn(
                  "flex size-4.5 shrink-0 items-center justify-center rounded-full border",
                  s.done ? "border-success bg-success text-white dark:text-[#14161a]" : "border-input",
                )}
              >
                {s.done && <Check className="size-3" aria-hidden />}
              </span>
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}


// ---------------------------------------------------------------------------
// How it's going
// ---------------------------------------------------------------------------

/** The last 30 days in three numbers, plus the most recent posts and how each did. */
export function HowItsGoing({ results }: { results: TodayResults }) {
  if (results.published === 0)
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-4 text-[14px] text-muted-foreground">
        Nothing published in the last 30 days yet. Once posts go out, their reach and replies show up here.
      </div>
    );
  const tiles = [
    { label: "Posts published", value: fmt(results.published) },
    { label: "People reached", value: fmt(results.impressions) },
    { label: "Likes, comments and shares", value: fmt(results.engagements) },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
        {tiles.map((t) => (
          <div key={t.label} className="grid content-start gap-1 px-3 py-4 sm:px-5">
            <span className="font-display text-[22px] leading-none font-semibold tabular-nums">{t.value}</span>
            <span className="text-[12px] leading-snug text-muted-foreground">{t.label}</span>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-rule">
        {results.recent.map((r) => (
          <li key={r.variantId}>
            <Link href={`/posts/${r.postId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50">
              <PlatformIcon platform={r.platform} className="size-5 text-[8px]" />
              <span className="min-w-0 flex-1 truncate text-[14px]">{r.title}</span>
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                {fmt(r.impressions)}
                <span className="hidden sm:inline"> reach · {fmt(r.engagements)} eng.</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
