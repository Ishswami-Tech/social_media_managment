import { createMemoryRateLimiter, createRateLimiter, type RateLimiter } from "@platform/queue";
import { ApiError } from "./errors";
import { getEnv } from "./env";
import { errorInfo, logger } from "./logger";
import type { OrgContext } from "./session";

declare global {
  var __platformRateLimiter: RateLimiter | undefined;
}

function limiter(): RateLimiter {
  if (!globalThis.__platformRateLimiter) {
    const env = getEnv();
    globalThis.__platformRateLimiter =
      env.NODE_ENV === "test" ? createMemoryRateLimiter() : createRateLimiter(env.REDIS_URL);
  }
  return globalThis.__platformRateLimiter;
}

/**
 * Per-organization budget for AI endpoints (default 60 calls per minute,
 * `AI_RATE_LIMIT_PER_MINUTE` overrides). Throws a 429 with Retry-After when
 * exceeded. If Redis is unreachable the request is allowed and the failure
 * logged: a rate limiter must never take the product down.
 */
export async function enforceAiRateLimit(ctx: Pick<OrgContext, "organization">, scope = "ai"): Promise<void> {
  const max = getEnv().AI_RATE_LIMIT_PER_MINUTE;
  if (!max || max <= 0) return;
  try {
    const result = await limiter().hit(`${scope}:${ctx.organization.id}`, max, 60);
    if (!result.allowed) {
      throw new ApiError(
        429,
        `AI rate limit reached (${max} per minute). Retry in ${result.retryAfterSeconds}s.`,
        "rate_limited",
        undefined,
        { "retry-after": String(result.retryAfterSeconds) },
      );
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    logger.warn("rate limiter unavailable; allowing request", errorInfo(e));
  }
}
