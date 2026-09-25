import { describe, expect, it } from "vitest";
import { mergeBriefs } from "../src/stages/research";
import { pickStrategy } from "../src/stages/strategy";
import { tally } from "../src/stages/judge";
import { PipelineBlocked } from "../src/errors";
import { council, coolingProviders, councilPrefs, otherSeats, topPerProvider, uniqueStrings } from "../src/stages/council";
import { ModelRouter, type ModelInfo } from "@platform/ai-core";
import { createCircuitBreaker } from "../src/circuit-breaker";
import { createTestContext } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

describe("a council behind one seat", () => {
  it("merges three briefs into one without repeating sources or points", () => {
    const merged = mergeBriefs([
      { title: "A", summary: "First.", keyPoints: ["Queues fall", "Replies matter"], angles: [{ hook: "Story", why: "x" }], postIdeas: [], sources: [{ title: "S1", url: "https://a" }], caveats: ["Small sample"] },
      { title: "B", summary: "Second.", keyPoints: ["replies matter", "Speed wins"], angles: [{ hook: "story", why: "y" }, { hook: "Data", why: "z" }], postIdeas: [], sources: [{ title: "S1 again", url: "https://a" }, { title: "S2", url: "https://b" }], caveats: ["small sample", "Old data"] },
    ]);
    expect(merged.title).toBe("B");
    expect(merged.summary).toBe("Second.\n\nFirst.");
    expect(merged.keyPoints).toEqual(["replies matter", "Speed wins", "Queues fall"]);
    expect(merged.angles.map((a) => a.hook)).toEqual(["story", "Data"]);
    expect(merged.sources.map((s) => s.url)).toEqual(["https://a", "https://b"]);
    expect(merged.sources[0]?.title).toBe("S1 again");
    expect(merged.caveats).toEqual(["small sample", "Old data"]);
  });

  it("keeps the strategy that leans on the most facts", () => {
    const best = pickStrategy([
      { claimIds: ["c1"], value: { rationale: "short" } },
      { claimIds: ["c1", "c2"], value: { rationale: "longer one" } },
      { claimIds: ["c1", "c2"], value: { rationale: "a" } },
    ]);
    expect(best.value.rationale).toBe("longer one");
  });

  it("lets three judges vote by average score", () => {
    const verdict = tally(
      [
        { winner: "A", scores: [{ label: "A", score: 50, rationale: "tight" }, { label: "B", score: 40, rationale: "loose" }], borrow: ["B's close"] },
        { winner: "B", scores: [{ label: "A", score: 42, rationale: "fine" }, { label: "B", score: 48, rationale: "warm" }], borrow: [] },
        { winner: "B", scores: [{ label: "A", score: 40, rationale: "fine" }, { label: "B", score: 49, rationale: "warm" }], borrow: ["b's close"] },
      ],
      ["A", "B"],
    );
    expect(verdict.winner).toBe("B");
    expect(verdict.scores.find((s) => s.label === "B")?.score).toBe(45.7);
    expect(verdict.scores.find((s) => s.label === "A")?.rationale).toBe("tight · fine");
    expect(verdict.borrow).toEqual(["B's close"]);
  });

  it("seats one model per provider first and skips providers that are cooling down", async () => {
    const { ctx } = createTestContext(baseRun());
    ctx.councilSize = 3;
    const spread = await councilPrefs(ctx);
    expect(spread.map((p) => p.provider)).toEqual(["OPENAI", "ANTHROPIC", "GOOGLE"]);

    await ctx.health.recordFailure("OPENAI", "no credits");
    await ctx.health.recordFailure("OPENAI", "no credits");
    await ctx.health.recordFailure("OPENAI", "no credits");
    await ctx.health.recordFailure("OPENAI", "no credits");
    await ctx.health.recordFailure("OPENAI", "no credits");
    const withoutOpenAI = await councilPrefs(ctx);
    expect(withoutOpenAI.map((p) => p.provider)).not.toContain("OPENAI");
    expect(withoutOpenAI.map((p) => p.model)).toEqual(["claude-test", "gemini-test", "gemini-test-2"]);

    ctx.councilSize = 1;
    expect(await councilPrefs(ctx)).toEqual([{}]);
  });

  it("plans on the breaker's state without spending its half-open probe", async () => {
    let at = 1_000_000;
    const breaker = createCircuitBreaker({ failureThreshold: 2, windowMs: 60_000, openMs: 1_000 }, () => at);
    await breaker.recordFailure("GOOGLE", "quota");
    await breaker.recordFailure("GOOGLE", "quota");
    expect(await breaker.isHealthy("GOOGLE")).toBe(false);
    at += 5_000;
    // Still not closed: planning leaves Google out, and the one probe is still there for a real call.
    expect(await breaker.isHealthy("GOOGLE")).toBe(false);
    expect(await breaker.isOpen("GOOGLE")).toBe(false);
    expect(await breaker.isOpen("GOOGLE")).toBe(true);
    await breaker.recordSuccess("GOOGLE", 10);
    expect(await breaker.isHealthy("GOOGLE")).toBe(true);

    const { ctx } = createTestContext(baseRun());
    ctx.health = breaker;
    await breaker.recordFailure("OPENAI", "no credits");
    await breaker.recordFailure("OPENAI", "no credits");
    expect([...(await coolingProviders(ctx))]).toEqual(["OPENAI"]);
  });

  it("keeps the answers it got and puts a lost seat on the record", async () => {
    const lost: number[] = [];
    const answers = await council(
      [{ provider: "OPENAI", model: "a" }, { provider: "GOOGLE", model: "b" }, { provider: "ANTHROPIC", model: "c" }],
      async (pref, index) => {
        if (index === 1) throw new Error("connection reset");
        return pref.model;
      },
      async (index) => {
        lost.push(index);
      },
    );
    expect(answers).toEqual(["a", "c"]);
    expect(lost).toEqual([1]);

    await expect(
      council([{}, {}], async (_pref, index) => {
        if (index === 0) throw new PipelineBlocked("budget exhausted");
        return "x";
      }),
    ).rejects.toBeInstanceOf(PipelineBlocked);
    await expect(
      council([{}], async () => {
        throw new Error("nobody home");
      }),
    ).rejects.toThrow("nobody home");
  });

  it("reuses a provider's best models before it reaches for its worst", async () => {
    const catalogue: ModelInfo[] = Array.from({ length: 9 }, (_, i) => ({
      provider: "GOOGLE" as const,
      model: `g${i + 1}`,
      capabilities: ["text", "json"],
      inputCostPerM: i + 1,
      outputCostPerM: i + 1,
    }));
    const { ctx } = createTestContext(baseRun(), { availableProviders: ["GOOGLE"] });
    ctx.router = new ModelRouter(catalogue);
    ctx.councilSize = 3;
    for (const m of ["g1", "g2", "g3", "g4", "g5"]) ctx.modelsInUse?.add(`GOOGLE::${m}`);
    // One fresh model left among the best six: the bench reuses g1..g3 rather than seating g7..g9.
    expect((await councilPrefs(ctx)).map((p) => p.model)).toEqual(["g1", "g2", "g3"]);
    expect(topPerProvider(catalogue, 2).map((m) => m.model)).toEqual(["g1", "g2"]);
  });

  it("tells each seat which models its colleagues hold", () => {
    const prefs = [{ provider: "OPENAI" as const, model: "gpt-test" }, {}, { provider: "GOOGLE" as const, model: "gemini-test" }];
    expect(otherSeats(prefs, 0)).toEqual(["GOOGLE::gemini-test"]);
    expect(otherSeats(prefs, 2)).toEqual(["OPENAI::gpt-test"]);
  });

  it("dedupes strings without caring about case", () => {
    expect(uniqueStrings([" a", "A", "b", ""])).toEqual(["a", "b"]);
  });
});
