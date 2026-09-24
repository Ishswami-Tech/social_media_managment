import Link from "next/link";
import { CalendarClock, CheckCircle2, Inbox, TrendingUp } from "lucide-react";
import { CountUp } from "@/components/ui/count-up";

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

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `today ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** The four numbers that tell you what to do next, straight from the database. */
export function TodayBar({ stats }: { stats: TodayStats }) {
  const tiles = [
    {
      icon: Inbox,
      label: "Waiting for you",
      value: <CountUp value={stats.awaiting} />,
      href: stats.awaiting > 0 ? "#waiting" : undefined,
      tone: stats.awaiting > 0 ? "text-brand" : "text-muted-foreground",
    },
    {
      icon: CheckCircle2,
      label: "Published this month",
      value: <CountUp value={stats.publishedThisMonth} />,
      href: "/posts",
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      icon: CalendarClock,
      label: "Next going out",
      value: stats.nextScheduledAt ? when(stats.nextScheduledAt) : "nothing scheduled",
      href: "/posts",
      tone: "text-foreground",
    },
    {
      icon: TrendingUp,
      label: "Best reach this month",
      value: stats.topReach ? `${fmt(stats.topReach.impressions)} views` : "no results yet",
      href: stats.topReach ? `/posts/${stats.topReach.postId}` : "/analytics",
      tone: "text-foreground",
    },
  ] as const;

  return (
    <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((t) => {
        const Icon = t.icon;
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Icon className="size-3.5" aria-hidden /> {t.label}
            </span>
            <span className={`text-lg font-semibold leading-tight ${t.tone}`}>{t.value}</span>
          </>
        );
        const className =
          "grid gap-1 rounded-xl border border-white/60 bg-white/55 px-3 py-2.5 shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/[0.04]";
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
