import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Label, big tabular number, one-line hint. Flat card, no chrome. */
export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  className,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{title}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" />}
      </div>
      <div className="mt-2 font-display text-[28px] leading-none font-semibold tabular-nums">{value}</div>
      {hint && <p className="mt-2 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
