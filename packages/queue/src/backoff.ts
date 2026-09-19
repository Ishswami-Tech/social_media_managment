/**
 * Exponential backoff with full jitter (spec §15). Attempts are 1-based.
 * attempt 1 -> ~30s, 2 -> ~1m, 3 -> ~2m, 4 -> ~4m, 5 -> ~8m, capped at 30m.
 */
export function backoffMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; jitter?: boolean; random?: () => number } = {},
): number {
  const base = opts.baseMs ?? 30_000;
  const max = opts.maxMs ?? 30 * 60_000;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  if (opts.jitter === false) return exp;
  const rnd = opts.random ?? Math.random;
  return Math.floor(exp / 2 + rnd() * (exp / 2));
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

/**
 * Central retry policy for publishing. Transient errors retry with backoff
 * until maxAttempts; permanent errors (bad token, invalid content) never do.
 */
export function decideRetry(input: {
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  retryAfterMs?: number;
}): RetryDecision {
  if (!input.retryable) return { retry: false, delayMs: 0, reason: "permanent error" };
  if (input.attempt >= input.maxAttempts) return { retry: false, delayMs: 0, reason: "max attempts reached" };
  const delay = Math.max(input.retryAfterMs ?? 0, backoffMs(input.attempt));
  return { retry: true, delayMs: delay, reason: "transient error" };
}
