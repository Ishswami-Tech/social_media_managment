import Redis from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one hit against `key` and reports whether it is within `max` per `windowSeconds`. */
  hit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult>;
  close(): Promise<void>;
}

/**
 * Fixed-window counter in Redis (INCR + EXPIRE in one transaction). Shared by
 * every web instance so limits hold across replicas. Keys expire on their own.
 */
export function createRateLimiter(redisUrl: string): RateLimiter {
  // Commands queue until the connection is up (first call after boot); a dead
  // Redis fails fast after one retry so callers can fail open.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 3_000 });
  redis.on("error", () => {
    /* surfaced per command; avoids unhandled 'error' events crashing the process */
  });
  return {
    async hit(key, max, windowSeconds) {
      const bucket = `ratelimit:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
      const [[, count], [, ttl]] = (await redis
        .multi()
        .incr(bucket)
        .expire(bucket, windowSeconds, "NX")
        .ttl(bucket)
        .exec()
        .then((r) => [r![0], r![2]])) as [[unknown, number], [unknown, number]];
      const used = Number(count);
      return {
        allowed: used <= max,
        remaining: Math.max(0, max - used),
        retryAfterSeconds: Math.max(1, Number(ttl) > 0 ? Number(ttl) : windowSeconds),
      };
    },
    async close() {
      await redis.quit();
    },
  };
}

/** In-memory limiter for tests and single-process development without Redis. */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, max, windowSeconds) {
      const t = now();
      const current = buckets.get(key);
      const bucket = current && current.resetAt > t ? current : { count: 0, resetAt: t + windowSeconds * 1000 };
      const next = { ...bucket, count: bucket.count + 1 };
      buckets.set(key, next);
      return {
        allowed: next.count <= max,
        remaining: Math.max(0, max - next.count),
        retryAfterSeconds: Math.max(1, Math.ceil((next.resetAt - t) / 1000)),
      };
    },
    async close() {
      buckets.clear();
    },
  };
}
