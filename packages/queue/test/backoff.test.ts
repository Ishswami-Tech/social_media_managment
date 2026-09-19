import { describe, expect, it } from "vitest";
import { backoffMs, decideRetry, redisConnection } from "../src/index";

describe("backoffMs", () => {
  it("grows exponentially and caps", () => {
    expect(backoffMs(1, { jitter: false })).toBe(30_000);
    expect(backoffMs(2, { jitter: false })).toBe(60_000);
    expect(backoffMs(5, { jitter: false })).toBe(480_000);
    expect(backoffMs(20, { jitter: false })).toBe(30 * 60_000);
  });
  it("applies jitter within [half, full]", () => {
    expect(backoffMs(3, { random: () => 0 })).toBe(60_000);
    expect(backoffMs(3, { random: () => 0.999 })).toBeLessThan(120_000);
  });
});

describe("decideRetry", () => {
  it("never retries permanent errors", () => {
    expect(decideRetry({ attempt: 1, maxAttempts: 5, retryable: false }).retry).toBe(false);
  });
  it("retries transient errors until max attempts", () => {
    expect(decideRetry({ attempt: 1, maxAttempts: 5, retryable: true }).retry).toBe(true);
    expect(decideRetry({ attempt: 5, maxAttempts: 5, retryable: true }).retry).toBe(false);
  });
  it("honours retry-after when larger than backoff", () => {
    expect(decideRetry({ attempt: 1, maxAttempts: 5, retryable: true, retryAfterMs: 120_000 }).delayMs).toBe(120_000);
  });
});

describe("redisConnection", () => {
  it("parses redis URLs", () => {
    expect(redisConnection("redis://:pw@host:6380/2")).toMatchObject({
      host: "host",
      port: 6380,
      password: "pw",
      db: 2,
    });
    expect((redisConnection("rediss://h") as { tls?: object }).tls).toBeDefined();
  });
});
