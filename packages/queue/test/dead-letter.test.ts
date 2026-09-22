import { describe, expect, it } from "vitest";
import { attemptsExhausted, deadLetterJobId, retryJobId, toJobId } from "../src/index";

describe("deadLetterJobId", () => {
  it("combines queue, original id and failure time", () => {
    expect(deadLetterJobId("agent-run", "run__abc", "2026-09-21T10:00:00.000Z")).toBe(
      "agent-run:run__abc:2026-09-21T10:00:00.000Z",
    );
  });
  it("is BullMQ-safe once passed through toJobId", () => {
    expect(toJobId(deadLetterJobId("publish", "job1", "t"))).not.toContain(":");
  });
});

describe("retryJobId", () => {
  it("suffixes the original id so BullMQ does not dedupe against the failed job", () => {
    expect(retryJobId("run__abc", 1000)).toBe("run__abc:retry-1000");
    expect(retryJobId("run__abc", 1000)).not.toBe(retryJobId("run__abc", 1001));
  });
});

describe("attemptsExhausted", () => {
  it("treats a missing attempts option as a single attempt", () => {
    expect(attemptsExhausted(1, undefined)).toBe(true);
    expect(attemptsExhausted(0, undefined)).toBe(false);
  });
  it("requires every configured attempt to have failed", () => {
    expect(attemptsExhausted(2, 3)).toBe(false);
    expect(attemptsExhausted(3, 3)).toBe(true);
    expect(attemptsExhausted(4, 3)).toBe(true);
  });
});
