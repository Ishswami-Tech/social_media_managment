import { describe, expect, it } from "vitest";
import {
  CLOSED_RECORD,
  DEFAULT_BREAKER_CONFIG,
  createCircuitBreaker,
  nextState,
  type BreakerRecord,
} from "../src/circuit-breaker";
import { estimateCallCents, usageToCents, usdToCents } from "../src/budget";
import { ModelRouter } from "@platform/ai-core";

const config = DEFAULT_BREAKER_CONFIG;

function fail(record: BreakerRecord, at: number): BreakerRecord {
  return nextState(record, { type: "failure", at, error: "boom" }, config).record;
}

describe("nextState", () => {
  it("stays closed below the failure threshold", () => {
    let record = CLOSED_RECORD;
    for (let i = 0; i < 4; i++) record = fail(record, 1_000 + i);
    expect(record.state).toBe("CLOSED");
    expect(nextState(record, { type: "check", at: 5_000 }, config).open).toBe(false);
  });

  it("opens after 5 failures inside the window", () => {
    let record = CLOSED_RECORD;
    for (let i = 0; i < 5; i++) record = fail(record, 1_000 + i * 100);
    expect(record.state).toBe("OPEN");
    expect(nextState(record, { type: "check", at: 2_000 }, config).open).toBe(true);
  });

  it("forgets failures that fall out of the window", () => {
    let record = CLOSED_RECORD;
    for (let i = 0; i < 4; i++) record = fail(record, 1_000 + i);
    record = fail(record, 1_000 + config.windowMs + 10);
    expect(record.state).toBe("CLOSED");
    expect(record.failures).toHaveLength(1);
  });

  it("half-opens one probe after openMs and closes again on success", () => {
    let record = CLOSED_RECORD;
    for (let i = 0; i < 5; i++) record = fail(record, 1_000);
    const openedAt = record.changedAt;
    const probe = nextState(record, { type: "check", at: openedAt + config.openMs }, config);
    expect(probe.open).toBe(false);
    expect(probe.record.state).toBe("HALF_OPEN");

    const concurrent = nextState(probe.record, { type: "check", at: openedAt + config.openMs + 10 }, config);
    expect(concurrent.open).toBe(true);

    const closed = nextState(probe.record, { type: "success", at: openedAt + config.openMs + 20 }, config);
    expect(closed.record.state).toBe("CLOSED");
    expect(closed.record.failures).toHaveLength(0);
  });

  it("re-opens immediately when the probe fails", () => {
    let record = CLOSED_RECORD;
    for (let i = 0; i < 5; i++) record = fail(record, 1_000);
    const probe = nextState(record, { type: "check", at: 1_000 + config.openMs }, config).record;
    const reopened = nextState(probe, { type: "failure", at: 1_000 + config.openMs + 5, error: "still down" }, config);
    expect(reopened.record.state).toBe("OPEN");
    expect(reopened.open).toBe(true);
    expect(reopened.record.lastError).toBe("still down");
  });

  it("does not change state on success while closed", () => {
    const record = nextState(CLOSED_RECORD, { type: "success", at: 10 }, config).record;
    expect(record).toEqual(CLOSED_RECORD);
  });
});

describe("createCircuitBreaker", () => {
  it("implements ProviderHealthPort per provider", async () => {
    let now = 0;
    const breaker = createCircuitBreaker(config, () => now);
    expect(await breaker.isOpen("OPENAI")).toBe(false);

    for (let i = 0; i < 5; i++) await breaker.recordFailure("OPENAI", "429");
    expect(await breaker.isOpen("OPENAI")).toBe(true);
    expect(await breaker.isOpen("ANTHROPIC")).toBe(false);

    now += config.openMs;
    expect(await breaker.isOpen("OPENAI")).toBe(false);
    expect(breaker.snapshot("OPENAI").state).toBe("HALF_OPEN");

    await breaker.recordSuccess("OPENAI", 120);
    expect(breaker.snapshot("OPENAI").state).toBe("CLOSED");
    expect(await breaker.isOpen("OPENAI")).toBe(false);
  });
});

describe("budget helpers", () => {
  const router = new ModelRouter([
    { provider: "OPENAI", model: "gpt-5", capabilities: ["text", "json"], inputCostPerM: 1_000, outputCostPerM: 2_000 },
    { provider: "ANTHROPIC", model: "free", capabilities: ["text", "json"] },
  ]);

  it("rounds fractional cents up so the budget is never undercharged", () => {
    expect(usdToCents(0.0001)).toBe(1);
    expect(usdToCents(0)).toBe(0);
    expect(usdToCents(1.234)).toBe(124);
  });

  it("estimates from the catalogue and falls back when a model is not priced", () => {
    expect(estimateCallCents(router, "OPENAI", "gpt-5", 1_000_000, 1_000_000)).toBe(300_000);
    expect(estimateCallCents(router, "ANTHROPIC", "free", 1_000, 1_000)).toBe(2);
  });

  it("converts usage to whole cents", () => {
    expect(usageToCents(router, "OPENAI", "gpt-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(100_000);
  });
});
