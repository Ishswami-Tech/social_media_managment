/**
 * Bar charts for the results page.
 *
 * Deliberately dependency-free and server-rendered: the data is a short list
 * of numbers, so a charting library would ship a few hundred kilobytes of
 * client JavaScript to draw rectangles that CSS already draws. Each chart is
 * also a table to a screen reader, which a canvas-based library would not be.
 */
import { cn } from "@/lib/utils";

export interface Bar {
  label: string;
  value: number;
  /** Shown on hover and read out; falls back to the label. */
  full?: string;
  /** A second, quieter number drawn behind the first, e.g. posts behind reactions. */
  secondary?: number;
}

/** Nothing to divide by when every bar is zero, and a flat baseline is the honest picture. */
const scaleOf = (bars: Bar[]) => Math.max(1, ...bars.map((b) => Math.max(b.value, b.secondary ?? 0)));

export interface TimeBarsProps {
  bars: Bar[];
  /** What the tall bar counts, e.g. "reactions". */
  valueLabel: string;
  /** What the faint bar counts, when there is one. */
  secondaryLabel?: string;
  /** Shown instead of the chart when there is nothing to draw. */
  empty?: string;
  className?: string;
}

/** Vertical bars over time. Every nth label is drawn so a long window stays readable. */
export function TimeBars({ bars, valueLabel, secondaryLabel, empty = "Nothing yet.", className }: TimeBarsProps) {
  if (bars.length === 0 || bars.every((b) => b.value === 0 && !b.secondary)) {
    return <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>{empty}</p>;
  }
  const scale = scaleOf(bars);
  const everyNth = Math.ceil(bars.length / 8);

  return (
    <figure className={cn("grid gap-2", className)}>
      <div className="flex h-36 items-end gap-1" role="img" aria-label={`${valueLabel} over time`}>
        {bars.map((bar, i) => (
          <div key={`${bar.label}-${i}`} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
            {bar.secondary !== undefined && bar.secondary > 0 && (
              <span
                className="absolute bottom-0 w-full rounded-t-[3px] bg-muted"
                style={{ height: `${(bar.secondary / scale) * 100}%` }}
                aria-hidden
              />
            )}
            <span
              className="relative w-full rounded-t-[3px] bg-brand transition-colors group-hover:bg-brand-2"
              style={{ height: `${(bar.value / scale) * 100}%`, minHeight: bar.value > 0 ? "2px" : "0" }}
            >
              <span className="sr-only">
                {bar.full ?? bar.label}: {bar.value} {valueLabel}
                {bar.secondary !== undefined && secondaryLabel ? `, ${bar.secondary} ${secondaryLabel}` : ""}
              </span>
            </span>
            {/* Native tooltip: no portal, no client JS, and it survives a server render. */}
            <span className="absolute inset-0" title={tooltip(bar, valueLabel, secondaryLabel)} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 text-[11px] text-muted-foreground">
        {bars.map((bar, i) => (
          <span key={`${bar.label}-axis-${i}`} className="min-w-0 flex-1 truncate text-center">
            {i % everyNth === 0 ? bar.label : " "}
          </span>
        ))}
      </div>
      {secondaryLabel && (
        <figcaption className="flex gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-brand" aria-hidden /> {valueLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-muted" aria-hidden /> {secondaryLabel}
          </span>
        </figcaption>
      )}
    </figure>
  );
}

function tooltip(bar: Bar, valueLabel: string, secondaryLabel?: string): string {
  const head = `${bar.full ?? bar.label}: ${bar.value} ${valueLabel}`;
  return bar.secondary !== undefined && secondaryLabel ? `${head}, ${bar.secondary} ${secondaryLabel}` : head;
}

export interface RankedBar {
  key: string;
  label: string;
  value: number;
  /** Right-hand caption, e.g. "4 posts". */
  note?: string;
  /** Rendered before the label, e.g. a platform icon. */
  icon?: React.ReactNode;
}

/** Horizontal bars for comparing a handful of named things, longest first. */
export function RankedBars({
  bars,
  valueLabel,
  empty = "Nothing yet.",
  className,
}: {
  bars: RankedBar[];
  valueLabel: string;
  empty?: string;
  className?: string;
}) {
  if (bars.length === 0) return <p className={cn("py-6 text-sm text-muted-foreground", className)}>{empty}</p>;
  const scale = Math.max(1, ...bars.map((b) => b.value));

  return (
    <ul className={cn("grid gap-3", className)}>
      {bars.map((bar) => (
        <li key={bar.key} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {bar.icon}
              <span className="truncate">{bar.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {bar.value.toLocaleString()}
              {bar.note && <span className="ml-2 text-xs text-muted-foreground">{bar.note}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
              style={{ width: `${(bar.value / scale) * 100}%` }}
              role="img"
              aria-label={`${bar.label}: ${bar.value} ${valueLabel}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
