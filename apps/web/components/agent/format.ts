/** Formatting helpers shared by the Agent Council screens. */

/** Cents (possibly fractional) rendered as a dollar amount, e.g. 1234.5 → "$12.35". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Milliseconds rendered compactly, e.g. 850 → "850 ms", 4200 → "4.2 s". */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Human label for an enum-ish constant, e.g. "AWAITING_APPROVAL" → "Awaiting approval". */
export function humanize(value: string): string {
  const lower = value.replaceAll("_", " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
