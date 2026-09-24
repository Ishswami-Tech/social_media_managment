import Link from "next/link";
import { CalendarClock, Cpu, Eye, Heart, Inbox, MessageCircle, TrendingUp } from "lucide-react";
import type { HomeRail, ModelUse, ResultItem, UpcomingItem, WaitingItem } from "@/lib/home/rail";
import { PlatformIcon } from "@/components/app/platform-icon";
import { formatDate, truncate } from "@/lib/utils";

const PANEL =
  "grid min-w-0 gap-2 overflow-hidden rounded-xl border border-white/60 bg-white/55 p-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]";
const ROW = "grid min-w-0 gap-0.5 rounded-lg px-2 py-1.5 transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]";

function Panel({
  icon: Icon,
  title,
  href,
  children,
}: {
  icon: typeof Inbox;
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={PANEL} aria-label={title}>
      <h2 className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden /> {title}
        </span>
        {href && (
          <Link href={href} className="normal-case tracking-normal underline-offset-4 hover:underline">
            all
          </Link>
        )}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>;
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

function WaitingRow({ item }: { item: WaitingItem }) {
  return (
    <Link href={`#run-${item.runId}`} className={ROW}>
      <span className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{truncate(item.topic, 48)}</span>
        {item.score !== null && (
          <span className="shrink-0 rounded-full bg-brand/15 px-1.5 text-[11px] font-semibold text-brand">{item.score}</span>
        )}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {item.accounts.join(", ") || "no account"} · waiting {ago(item.waitingSince)}
      </span>
    </Link>
  );
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  return (
    <Link href={`/posts/${item.postId}`} className={ROW}>
      <span className="flex items-center gap-1.5 text-sm">
        {item.platforms.map((p) => (
          <PlatformIcon key={p} platform={p} className="size-4 text-[8px]" />
        ))}
        <span className="min-w-0 truncate font-medium">{truncate(item.text, 44)}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {formatDate(item.scheduledAt, { weekday: "short", hour: "2-digit", minute: "2-digit" }, item.timezone)}
      </span>
    </Link>
  );
}

function ResultRow({ item }: { item: ResultItem }) {
  const hasNumbers = item.impressions !== undefined || item.likes !== undefined || item.comments !== undefined;
  return (
    <Link href={`/posts/${item.postId}`} className={ROW}>
      <span className="flex items-center gap-1.5 text-sm">
        <PlatformIcon platform={item.platform} className="size-4 text-[8px]" />
        <span className="min-w-0 truncate font-medium">{truncate(item.text, 44)}</span>
      </span>
      <span className="flex items-center gap-3 text-xs text-muted-foreground">
        {hasNumbers ? (
          <>
            <span className="flex items-center gap-1"><Eye className="size-3" aria-hidden /> {fmt(item.impressions ?? 0)}</span>
            <span className="flex items-center gap-1"><Heart className="size-3" aria-hidden /> {fmt(item.likes ?? 0)}</span>
            <span className="flex items-center gap-1"><MessageCircle className="size-3" aria-hidden /> {fmt(item.comments ?? 0)}</span>
          </>
        ) : (
          <span>numbers arrive after the first analytics sync</span>
        )}
      </span>
    </Link>
  );
}

function ModelRow({ item, max }: { item: ModelUse; max: number }) {
  const width = Math.max(8, Math.round((item.drafts / max) * 100));
  return (
    <div className="grid gap-1 px-2 py-1">
      <span className="flex items-center justify-between text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium">{item.label}</span>
          <span className="text-muted-foreground"> · {item.providerLabel}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">{item.drafts} drafts</span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

/** The at-a-glance column beside the feed: decisions, schedule, results, models. */
export function DashboardRail({ rail }: { rail: HomeRail }) {
  const maxDrafts = Math.max(1, ...rail.models.map((m) => m.drafts));
  return (
    <aside className="grid min-w-0 content-start gap-3" aria-label="Overview">
      <Panel icon={Inbox} title="Waiting for you">
        {rail.waiting.length === 0 ? <Empty>Nothing needs a decision.</Empty> : rail.waiting.map((w) => <WaitingRow key={w.runId} item={w} />)}
      </Panel>
      <Panel icon={CalendarClock} title="Going out next" href="/posts?filter=scheduled">
        {rail.upcoming.length === 0 ? <Empty>Nothing scheduled. Approve a post with a time to fill this.</Empty> : rail.upcoming.map((u) => <UpcomingRow key={u.postId} item={u} />)}
      </Panel>
      <Panel icon={TrendingUp} title="Latest results" href="/analytics">
        {rail.results.length === 0 ? <Empty>No published posts yet.</Empty> : rail.results.map((r) => <ResultRow key={`${r.postId}:${r.platform}`} item={r} />)}
      </Panel>
      <Panel icon={Cpu} title="Models writing today">
        {rail.models.length === 0 ? <Empty>No drafts in the last 24 hours.</Empty> : rail.models.map((m) => <ModelRow key={`${m.provider}:${m.model}`} item={m} max={maxDrafts} />)}
      </Panel>
    </aside>
  );
}
