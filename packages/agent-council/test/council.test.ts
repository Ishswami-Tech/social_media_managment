import { describe, expect, it } from "vitest";
import { mergeBriefs } from "../src/stages/research";
import { pickStrategy } from "../src/stages/strategy";
import { tally } from "../src/stages/judge";
import { PipelineBlocked } from "../src/errors";
import {
  council,
  coolingProviders,
  councilPrefs,
  otherSeats,
  seatPerspective,
  stageCouncilSize,
  topPerProvider,
  uniqueStrings,
  withPerspective,
} from "../src/stages/council";
import { firstLine, lesson, mergeCouncilMemory } from "../src/council-memory";
import { ModelRouter, type ModelInfo } from "@platform/ai-core";
import { createCircuitBreaker } from "../src/circuit-breaker";
import { resolveProvider } from "../src/stages/call";
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
    // The window has passed: the planner may seat Google again, and the probe it needs is still unspent.
    expect(await breaker.isHealthy("GOOGLE")).toBe(true);
    expect(await breaker.isOpen("GOOGLE")).toBe(false);
    expect(await breaker.isOpen("GOOGLE")).toBe(true);
    await breaker.recordSuccess("GOOGLE", 10);
    expect(await breaker.isHealthy("GOOGLE")).toBe(true);

    const { ctx } = createTestContext(baseRun());
    ctx.health = breaker;
    await breaker.recordFailure("OPENAI", "no credits");
    await breaker.recordFailure("OPENAI", "no credits");
    expect([...(await coolingProviders(ctx))]).toEqual(["OPENAI"]);
    // Once its window passes, OpenAI is back on the bench without anyone touching the breaker.
    at += 2_000;
    expect([...(await coolingProviders(ctx))]).toEqual([]);
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

  it("picks a provider without spending the breaker's probe", async () => {
    const calls = { isOpen: 0, isHealthy: 0 };
    const { ctx } = createTestContext(baseRun());
    ctx.health = {
      ...ctx.health,
      isOpen: async () => {
        calls.isOpen += 1;
        return false;
      },
      isHealthy: async () => {
        calls.isHealthy += 1;
        return true;
      },
    };
    const first = await resolveProvider(ctx, "json");
    const second = await resolveProvider(ctx, "json");
    // The probe belongs to the call that gets made, never to the search that chose it.
    expect(calls.isOpen).toBe(0);
    expect(calls.isHealthy).toBeGreaterThan(0);
    expect(second.provider).toBe(first.provider);
  });

  it("closes a breaker on any success, so a recovered provider stops looking broken", async () => {
    let at = 1_000_000;
    const breaker = createCircuitBreaker({ failureThreshold: 2, windowMs: 60_000, openMs: 1_000 }, () => at);
    await breaker.recordFailure("GOOGLE", "quota");
    await breaker.recordFailure("GOOGLE", "quota");
    expect(breaker.snapshot("GOOGLE").state).toBe("OPEN");
    at += 5_000;
    // The call that the expired window allowed came back fine; nothing should still say Google is down.
    await breaker.recordSuccess("GOOGLE", 12);
    expect(breaker.snapshot("GOOGLE").state).toBe("CLOSED");
    expect(await breaker.isOpen("GOOGLE")).toBe(false);
  });

  it("tells each seat which models its colleagues hold", () => {
    const prefs = [{ provider: "OPENAI" as const, model: "gpt-test" }, {}, { provider: "GOOGLE" as const, model: "gemini-test" }];
    expect(otherSeats(prefs, 0)).toEqual(["GOOGLE::gemini-test"]);
    expect(otherSeats(prefs, 2)).toEqual(["OPENAI::gpt-test"]);
  });

  it("gives every seat of a council its own perspective and a lone seat none", () => {
    const seats = [0, 1, 2].map((i) => seatPerspective("research", i, 3));
    expect(seats.map((s) => s?.match(/COUNCIL: (\w+)/)?.[1])).toEqual(["Evidence", "Counterpoint", "Practice"]);
    expect(new Set(seats).size).toBe(3);
    expect(seatPerspective("judge", 1, 3)).toContain("Craft");
    expect(seatPerspective("research", 0, 1)).toBeUndefined();
    expect(withPerspective("Do it.", undefined)).toBe("Do it.");
    expect(withPerspective("Do it.", "YOUR SEAT")).toBe("Do it.\nYOUR SEAT");
  });

  it("learns from a run and keeps the memory small", () => {
    const first = mergeCouncilMemory(undefined, {
      winnerLane: "Story",
      winnerFirstLine: "Last Tuesday the queue hit 14 people.\nThen it changed.",
      reviewIssues: ["Cut the cliché “game-changer”.", "Ends without a question."],
      angle: "The two-minute reply rule",
      at: "2026-09-26T00:00:00.000Z",
    });
    expect(first.runs).toBe(1);
    expect(first.winningLanes).toEqual([{ lane: "Story", wins: 1 }]);
    expect(first.winningHooks).toEqual(["Last Tuesday the queue hit 14 people."]);
    const second = mergeCouncilMemory(first, {
      winnerLane: "Evidence",
      reviewIssues: ["cut the cliche 'unlock'", "ends without a question!"],
      angle: "the two-minute reply rule",
    });
    expect(second.runs).toBe(2);
    expect(second.winningLanes?.map((l) => l.lane)).toEqual(["Story", "Evidence"]);
    expect(second.recurringNotes?.map((n) => n.count)).toEqual([2, 2]);
    expect(second.recurringNotes?.find((n) => /question/.test(n.note))).toEqual({ note: "Ends without a question.", count: 2 });
    expect(second.recurringNotes?.find((n) => /cliché/.test(n.note))?.count).toBe(2);
    // The newest spelling of a repeated angle is the one kept.
    expect(second.recentAngles).toEqual(["the two-minute reply rule"]);
    expect(first.runs).toBe(1);
    expect(firstLine("\n\n  Hello there  \nmore")).toBe("Hello there");
    expect(lesson('"Hashtags: #cafe" — the "Hashtags:" label is not native LinkedIn formatting.')).toBe('The "Hashtags:" label is not native LinkedIn formatting.');
    expect(lesson("Ends without a question.")).toBe("Ends without a question.");
    expect(lesson("\"Cafe owners, what's your queue like?\" — opens with a question, which the playbook forbids.")).toBe("Opens with a question, which the playbook forbids.");
  });

  it("dedupes strings without caring about case", () => {
    expect(uniqueStrings([" a", "A", "b", ""])).toEqual(["a", "b"]);
  });

  it("sizes each stage selectively from the org width", () => {
    const { ctx } = createTestContext(baseRun());
    ctx.councilSize = 5;
    expect(stageCouncilSize(ctx, "research")).toBe(3);
    expect(stageCouncilSize(ctx, "strategy")).toBe(5);
    expect(stageCouncilSize(ctx, "judge")).toBe(5);
    expect(stageCouncilSize(ctx, "review")).toBe(1);
    expect(stageCouncilSize(ctx, "review", { assurance: "JUDGE_ONLY" })).toBe(1);
    expect(stageCouncilSize(ctx, "review", { assurance: "HIGH_ASSURANCE" })).toBe(5);

    ctx.councilSize = 2;
    expect(stageCouncilSize(ctx, "research")).toBe(2);
    expect(stageCouncilSize(ctx, "strategy")).toBe(2);
    expect(stageCouncilSize(ctx, "review", { assurance: "HIGH_ASSURANCE" })).toBe(2);

    ctx.councilSize = undefined;
    expect(stageCouncilSize(ctx, "strategy")).toBe(1);
    expect(stageCouncilSize(ctx, "research")).toBe(1);
  });

  it("honours a size override when seating prefs", async () => {
    const { ctx } = createTestContext(baseRun());
    ctx.councilSize = 5;
    const narrow = await councilPrefs(ctx, new Set(), 1);
    expect(narrow).toEqual([{}]);
    const capped = await councilPrefs(ctx, new Set(), stageCouncilSize(ctx, "research"));
    expect(capped).toHaveLength(3);
  });
});
