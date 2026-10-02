import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(
  d: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
  timeZone?: string,
) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(date);
}

export function truncate(s: string, n = 80) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function initials(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** 38200 → "38.2k", 1904 → "1,904". */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return n.toLocaleString("en-US");
}

function zonedParts(iso: string, timeZone: string): Record<string, string> {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return Object.fromEntries(new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  } catch {
    return Object.fromEntries(new Intl.DateTimeFormat("en-GB", opts).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  }
}

/** "Sat 3 Oct" — assembled from parts so the server and every browser print the same thing. */
export function dayLabel(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "09:30" in the given zone. */
export function timeLabel(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  return `${p.hour}:${p.minute}`;
}
