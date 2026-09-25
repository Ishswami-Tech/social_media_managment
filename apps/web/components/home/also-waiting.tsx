import Link from "next/link";
import { ChevronRight, Inbox } from "lucide-react";
import type { WaitingItem } from "@/lib/home/overview";
import { truncate } from "@/lib/utils";

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

/** The other posts waiting for a decision, one line each, opening the full review page. */
export function AlsoWaiting({ items }: { items: WaitingItem[] }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Also waiting for you"
      className="grid gap-1 rounded-2xl border border-border bg-card p-3 dark:border-border"
    >
      <h2 className="flex items-center gap-1.5 px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Inbox className="size-3.5" aria-hidden /> Also waiting for you · {items.length}
      </h2>
      {items.map((item) => (
        <Link
          key={item.runId}
          href={`/review/${item.runId}`}
          className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{truncate(item.topic, 80)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.accounts.join(", ") || "no account"} · waiting {ago(item.waitingSince)}
            </span>
          </span>
          {item.score !== null && (
            <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand">{item.score}</span>
          )}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ))}
    </section>
  );
}
