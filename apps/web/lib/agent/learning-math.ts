/**
 * Pure statistics used by the Account Brain learner. No I/O, no Prisma, so
 * the gating rules from docs/agent-council.md ("Learning") can be reasoned
 * about (and unit tested) in isolation.
 */

export interface WeightedSample {
  /** Observed value, e.g. engagement rate of one published post. */
  value: number;
  /** Non-negative weight, e.g. a recency weight. */
  weight: number;
}

/** Half-life used for recency weighting: a 30-day-old post counts half as much as today's. */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Minimum number of samples before an account profile may learn anything. */
export const MIN_SAMPLES = 5;

/** Minimum impressions summed over the samples before learning is trusted. */
export const MIN_IMPRESSIONS = 200;

/** Posts younger than this have not had time to accumulate metrics. */
export const MIN_AGE_DAYS = 3;

/** Human-feedback preference list is capped at this many entries. */
export const MAX_PREFERENCES = 20;

/** Multiplier applied to older preference weights whenever a new one is appended. */
export const PREFERENCE_DECAY = 0.9;

/** Exponential recency weight in (0, 1]: `2^(-ageDays / halfLife)`. */
export function recencyWeight(ageDays: number, halfLifeDays = RECENCY_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(2, -ageDays / halfLifeDays);
}

/** Weighted arithmetic mean; 0 when there is no weight. */
export function weightedAverage(samples: readonly WeightedSample[]): number {
  const total = samples.reduce((acc, s) => acc + s.weight, 0);
  if (total <= 0) return 0;
  return samples.reduce((acc, s) => acc + s.value * s.weight, 0) / total;
}

/**
 * Standard error of a weighted mean using Kish's effective sample size
 * `n_eff = (Σw)² / Σw²`, so heavily down-weighted old posts do not inflate
 * confidence. Returns Infinity when fewer than two samples exist.
 */
export function weightedStandardError(samples: readonly WeightedSample[]): number {
  if (samples.length < 2) return Number.POSITIVE_INFINITY;
  const mean = weightedAverage(samples);
  const sumW = samples.reduce((acc, s) => acc + s.weight, 0);
  const sumW2 = samples.reduce((acc, s) => acc + s.weight * s.weight, 0);
  if (sumW <= 0 || sumW2 <= 0) return Number.POSITIVE_INFINITY;
  const variance = samples.reduce((acc, s) => acc + s.weight * (s.value - mean) ** 2, 0) / sumW;
  const nEff = (sumW * sumW) / sumW2;
  return Math.sqrt(variance / nEff);
}

/**
 * Gate from the spec: a feature value only becomes a "best" when its weighted
 * mean is at least one standard error above the account baseline. Rejects
 * tiny groups (< 2 samples) because their standard error is undefined.
 */
export function shouldUpdateBaseline(samples: readonly WeightedSample[], baseline: number): boolean {
  if (samples.length < 2) return false;
  const mean = weightedAverage(samples);
  const se = weightedStandardError(samples);
  if (!Number.isFinite(se)) return false;
  return mean - baseline >= se;
}

export interface Preference {
  text: string;
  weight: number;
  source: "edit" | "rejection" | "comment" | "explicit";
  at: string;
}

/** Spec weights: 0.3 for an edit, 0.5 for a rejection comment, 1.0 for an explicit instruction. */
export const PREFERENCE_WEIGHTS: Record<Preference["source"], number> = {
  edit: 0.3,
  rejection: 0.5,
  comment: 0.5,
  explicit: 1,
};

/**
 * Append a preference: existing weights decay by `PREFERENCE_DECAY`, the list
 * is sorted by weight (highest first) and capped at `MAX_PREFERENCES`.
 * Returns a new array; the input is never mutated.
 */
export function appendPreference(existing: readonly Preference[], next: Preference): Preference[] {
  const decayed = existing.map((p) => ({ ...p, weight: Number((p.weight * PREFERENCE_DECAY).toFixed(4)) }));
  return [...decayed, next]
    .sort((a, b) => b.weight - a.weight || b.at.localeCompare(a.at))
    .slice(0, MAX_PREFERENCES);
}

/**
 * Short, human-readable description of how `after` differs from `before`.
 * Word-level: reports removed and added fragments (capped) plus a length hint.
 */
export function summarizeEdit(before: string, after: string, maxChars = 240): string {
  const a = tokenize(before);
  const b = tokenize(after);
  const setA = new Set(a);
  const setB = new Set(b);
  const removed = a.filter((w) => !setB.has(w));
  const added = b.filter((w) => !setA.has(w));
  const parts: string[] = [];
  if (removed.length) parts.push(`removed: ${uniq(removed).slice(0, 12).join(" ")}`);
  if (added.length) parts.push(`added: ${uniq(added).slice(0, 12).join(" ")}`);
  const delta = after.length - before.length;
  if (Math.abs(delta) >= 40) parts.push(delta < 0 ? `shortened by ${-delta} chars` : `lengthened by ${delta} chars`);
  const summary = parts.join("; ") || "minor wording changes";
  return summary.length > maxChars ? `${summary.slice(0, maxChars - 1)}…` : summary;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}#@]+|[^\p{L}\p{N}#@]+$/gu, ""))
    .filter((w) => w.length > 0);
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
