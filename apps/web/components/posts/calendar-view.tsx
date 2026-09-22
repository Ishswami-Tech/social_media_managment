import Link from "next/link";
import { cn, truncate } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";

export interface CalendarPost {
  id: string;
  title: string | null;
  masterText: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  variants: { platform: string }[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month grid of scheduled and published posts. Data is loaded by the page. */
export function CalendarView({
  posts,
  year,
  month,
  timezone,
}: {
  posts: CalendarPost[];
  /** Four digit year of the month shown. */
  year: number;
  /** Zero based month index of the month shown. */
  month: number;
  timezone: string;
}) {
  const start = new Date(Date.UTC(year, month, 1));
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      d,
    );
  const byDay = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    const key = dayKey(p.scheduledAt ?? p.publishedAt ?? p.createdAt);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  const firstWeekday = (start.getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  const prev = `${month === 0 ? year - 1 : year}-${String(month === 0 ? 12 : month).padStart(2, "0")}`;
  const next = `${month === 11 ? year + 1 : year}-${String(month === 11 ? 1 : month + 2).padStart(2, "0")}`;
  const todayKey = dayKey(new Date());

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/posts?view=calendar&m=${prev}`} aria-label="Previous month">
            ‹
          </Link>
        </Button>
        <span className="min-w-40 text-center text-sm font-medium">{label}</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/posts?view=calendar&m=${next}`} aria-label="Next month">
            ›
          </Link>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Times shown in {timezone}</span>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-muted p-2 text-center font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const key = day ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
          const items = day ? (byDay.get(key) ?? []) : [];
          return (
            <div key={i} className={cn("min-h-24 bg-background p-1.5", !day && "bg-muted/40")}>
              {day && <div className={cn("mb-1 text-right", key === todayKey && "font-bold")}>{day}</div>}
              <div className="grid gap-1">
                {items.slice(0, 3).map((p) => (
                  <Link
                    key={p.id}
                    href={`/posts/${p.id}`}
                    className="flex items-center gap-1 rounded border px-1 py-0.5 hover:bg-accent"
                  >
                    <PlatformIcon platform={p.variants[0]?.platform ?? "LINKEDIN"} className="size-4 text-[8px]" />
                    <span className="truncate">{p.title || truncate(p.masterText, 24)}</span>
                  </Link>
                ))}
                {items.length > 3 && <span className="text-muted-foreground">+{items.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
