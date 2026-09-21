import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "../src/rate-limit";

describe("createMemoryRateLimiter", () => {
  it("allows up to max hits per window, then blocks until the window resets", async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter(() => now);
    const first = await limiter.hit("org:a", 2, 60);
    const second = await limiter.hit("org:a", 2, 60);
    const third = await limiter.hit("org:a", 2, 60);
    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(60);

    now += 61_000;
    expect((await limiter.hit("org:a", 2, 60)).allowed).toBe(true);
  });

  it("keeps organizations independent", async () => {
    const limiter = createMemoryRateLimiter();
    await limiter.hit("org:a", 1, 60);
    expect((await limiter.hit("org:a", 1, 60)).allowed).toBe(false);
    expect((await limiter.hit("org:b", 1, 60)).allowed).toBe(true);
  });
});
