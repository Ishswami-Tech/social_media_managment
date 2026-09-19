import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { truncate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar" };

function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await requireOrg();
  const { m } = await searchParams;
  const now = new Date();
  const [y, mo] = m ? m.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const year = y ?? now.getUTCFullYear();
  const month = (mo ?? now.getUTCMonth() + 1) - 1;
  const { start, end } = monthRange(year, month);
  const posts = await prisma.post.findMany({
    where: {
      organizationId: ctx.organization.id,
      OR: [{ scheduledAt: { gte: start, lt: end } }, { publishedAt: { gte: start, lt: end } }],
    },
    include: { variants: { select: { platform: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  const tz = ctx.settings.timezone;
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const byDay = new Map<string, typeof posts>();
  for (const p of posts) {
    const d = p.scheduledAt ?? p.publishedAt ?? p.createdAt;
    const k = dayKey(d);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const firstWeekday = (start.getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  const prev = `${month === 0 ? year - 1 : year}-${String(month === 0 ? 12 : month).padStart(2, "0")}`;
  const next = `${month === 11 ? year + 1 : year}-${String(month === 11 ? 1 : month + 2).padStart(2, "0")}`;
  const todayKey = dayKey(now);

  return (
    <>
      <PageHeader title="Calendar" description={`Times shown in ${tz}`}>
        <Button asChild variant="outline" size="sm">
          <Link href={`/calendar?m=${prev}`}>‹</Link>
        </Button>
        <span className="min-w-40 text-center text-sm font-medium">{label}</span>
        <Button asChild variant="outline" size="sm">
          <Link href={`/calendar?m=${next}`}>›</Link>
        </Button>
      </PageHeader>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
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
    </>
  );
}
