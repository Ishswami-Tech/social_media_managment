import { describe, expect, it } from "vitest";
import { COUNCIL_SIZE_MAX, COUNCIL_SIZE_MIN, councilSizeOf } from "@/lib/agent/context";

/**
 * Council width decides how many independent models answer every decision of
 * every run. A bad value here does not fail loudly: it quietly changes the
 * writing and the bill for an entire organization, so it is clamped rather
 * than trusted.
 */
describe("how wide the council sits", () => {
  it("keeps today's three when nothing is configured", () => {
    expect(councilSizeOf(undefined)).toBe(3);
    expect(councilSizeOf(null)).toBe(3);
  });

  it("honours a sensible choice", () => {
    expect(councilSizeOf(1)).toBe(1);
    expect(councilSizeOf(2)).toBe(2);
    expect(councilSizeOf(5)).toBe(5);
  });

  it("never seats fewer than one model, whatever the database says", () => {
    expect(councilSizeOf(0)).toBe(COUNCIL_SIZE_MIN);
    expect(councilSizeOf(-7)).toBe(COUNCIL_SIZE_MIN);
  });

  it("refuses a width that would multiply the bill without improving the writing", () => {
    expect(councilSizeOf(50)).toBe(COUNCIL_SIZE_MAX);
  });

  it("falls back rather than passing nonsense to the planner", () => {
    expect(councilSizeOf(Number.NaN)).toBe(3);
    expect(councilSizeOf(Number.POSITIVE_INFINITY)).toBe(3);
    expect(councilSizeOf(2.9)).toBe(2);
  });
});
