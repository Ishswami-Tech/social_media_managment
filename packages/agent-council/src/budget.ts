import type { AIProviderName } from "@platform/types";
import type { ModelRouter, Usage } from "@platform/ai-core";

/** Used when the catalogue has no pricing for the routed model. */
export const FALLBACK_ESTIMATE_CENTS = 2;

/** Rough chars-per-token ratio used to size reservations before a call. */
export const CHARS_PER_TOKEN = 4;

/** Whole cents, rounded up so the budget is never under-charged. */
export function usdToCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * 100);
}

/** Actual cost of a completed call in whole cents (0 when the model is not priced). */
export function usageToCents(router: ModelRouter, provider: AIProviderName, model: string, usage: Usage): number {
  return usdToCents(router.estimateCost(provider, model, usage));
}

/**
 * Estimate to reserve before a call. Uses catalogue pricing when available and
 * a flat fallback otherwise; always at least one cent so a reservation exists.
 */
export function estimateCallCents(
  router: ModelRouter,
  provider: AIProviderName,
  model: string,
  expectedInputTokens: number,
  expectedOutputTokens: number,
): number {
  const usd = router.estimateCost(provider, model, {
    inputTokens: Math.max(0, expectedInputTokens),
    outputTokens: Math.max(0, expectedOutputTokens),
  });
  if (usd <= 0) return FALLBACK_ESTIMATE_CENTS;
  return Math.max(1, usdToCents(usd));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
