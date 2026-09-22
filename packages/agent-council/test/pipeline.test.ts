import { describe, expect, it } from "vitest";
import { AI_PROVIDERS } from "@platform/types";
import { advanceRun, decideNextAfterAdapting, runPipelineToCompletion, type PublishPolicy } from "../src/pipeline";
import { isPipelineBlocked } from "../src/errors";
import { planWriters } from "../src/stages/writers";
import { assertBlind, buildCandidates, resolveWinner } from "../src/stages/judge";
import { createTestContext, REVISED_TEXT, SYNTHESIZED_TEXT, WRITER_TEXTS } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

const ALLOWED = ["OPENAI::gpt-test", "ANTHROPIC::claude-test"];

function setup(options: Parameters<typeof createTestContext>[1] = {}) {
  return createTestContext(baseRun(), { allowedModels: ALLOWED, ...options });
}

describe("runPipelineToCompletion", () => {
  it("drives a run from QUEUED to ADAPTING and produces one recommendation per account", async () => {
    const { ctx, memory, script } = setup();

    const result = await runPipelineToCompletion(ctx, "run_1");

    expect(result).toEqual({ status: "ADAPTING", done: true });
    expect(memory.statuses).toEqual([
      "RESEARCHING",
      "STRATEGIZING",
      "DRAFTING",
      "REVIEWING",
      "JUDGING",
      "ADAPTING",
    ]);
    expect(memory.recommendations).toHaveLength(2);
    for (const rec of memory.recommendations) {
      expect(rec.finalText).toContain(SYNTHESIZED_TEXT.split("\n")[0]);
      expect(rec.winnerDraftLabel).toBe("A");
      expect(rec.winnerDraftId).toMatch(/^draft_/);
      expect(rec.mediaConcept).toBeTruthy();
    }
    expect(memory.recommendations.map((r) => r.runAccountId).sort()).toEqual(["racc_ig", "racc_li"]);
    expect(script.calls.some((c) => c.stage === "RESEARCH" && c.hasTools)).toBe(true);
  });

  it("stores the research brief and only keeps claim ids the store assigned", async () => {
    const { ctx, memory } = setup();
    await runPipelineToCompletion(ctx, "run_1");
    const snapshot = memory.snapshot();

    expect(snapshot.research?.sources[0]?.url).toBe("https://example.com/report");
    expect(snapshot.claims.map((c) => c.id)).toEqual(["cl_1", "cl_2"]);
    expect(snapshot.claims[0]?.status).toBe("SUPPORTED");
    for (const account of snapshot.accounts) {
      expect(account.strategy?.claimIds).toEqual(["cl_1"]);
      expect(account.drafts.find((d) => d.role === "WRITER")?.claimIds).toEqual(["cl_1"]);
    }
  });

  it("revises a draft that fails the checks and drops the failing version", async () => {
    const { ctx, memory } = setup();
    await runPipelineToCompletion(ctx, "run_1");
    const account = memory.snapshot().accounts[0]!;

    const writerB = account.drafts.find((d) => d.role === "WRITER" && d.label === "B");
    const revisionB = account.drafts.find((d) => d.role === "REVISION" && d.label === "B");
    expect(writerB?.text).toBe(WRITER_TEXTS[1]);
    expect(revisionB?.text).toBe(REVISED_TEXT);
    expect(memory.events.some((e) => e.step === "checks:racc_li:B" && e.status === "FAILED")).toBe(true);
    expect(memory.events.some((e) => e.step === "checks:racc_li:B.revision" && e.status === "SUCCEEDED")).toBe(true);
  });

  it("cross-reviews with another provider and judges blind on a provider that did not write", async () => {
    const { ctx, memory, script } = setup();
    await runPipelineToCompletion(ctx, "run_1");

    const crossReviews = script.calls.filter((c) => c.stage === "CROSS-REVIEW");
    expect(crossReviews.length).toBeGreaterThan(0);
    expect(memory.snapshot().accounts[0]?.reviewNotes?.[0]?.label).toBe("A");

    const judgeCalls = script.calls.filter((c) => c.stage === "JUDGE");
    expect(judgeCalls).toHaveLength(2);
    for (const call of judgeCalls) {
      expect(call.provider).toBe("GOOGLE");
      const prompt = `${call.system}\n${call.user}`;
      for (const name of AI_PROVIDERS) expect(prompt).not.toContain(name);
      for (const model of ["gpt-test", "claude-test", "gemini-test"]) expect(prompt).not.toContain(model);
      expect(prompt).not.toMatch(/temperature|costCents|provider/i);
    }
    expect(memory.judgements.map((j) => j.score).sort()).toEqual([39, 39, 48, 48]);
    expect(memory.snapshot().accounts[0]?.verdict?.winner).toBe("A");
  });

  it("spreads writers across the allow-listed providers and keeps the labels blind", async () => {
    const { ctx, script } = setup();
    await runPipelineToCompletion(ctx, "run_1");

    const writers = script.calls.filter((c) => c.stage === "WRITER");
    expect(writers).toHaveLength(4); // 2 drafts × 2 accounts
    expect(new Set(writers.map((c) => c.provider))).toEqual(new Set(["OPENAI", "ANTHROPIC"]));
    expect(new Set(writers.map((c) => c.model))).toEqual(new Set(["gpt-test", "claude-test"]));
  });

  it("reserves and settles the budget once per model call and records the cost on the run", async () => {
    const { ctx, memory, money, script } = setup();
    await runPipelineToCompletion(ctx, "run_1");

    expect(money.reserved).toHaveLength(script.calls.length);
    expect(money.settled).toHaveLength(script.calls.length);
    expect(money.released).toEqual([]);
    expect(memory.snapshot().spentCents).toBeGreaterThan(0);
  });

  it("writes a STARTED and a SUCCEEDED event with prompt provenance for every model call", async () => {
    const { ctx, memory, script } = setup();
    await runPipelineToCompletion(ctx, "run_1");

    const started = memory.events.filter((e) => e.status === "STARTED" && e.promptKey);
    const succeeded = memory.events.filter((e) => e.status === "SUCCEEDED" && e.promptKey);
    expect(started).toHaveLength(script.calls.length);
    expect(succeeded).toHaveLength(script.calls.length);
    for (const event of succeeded) {
      expect(event.promptVersion).toBe(1);
      expect(event.promptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(event.model).toBeTruthy();
      expect(typeof event.costCents).toBe("number");
    }
    const steps = memory.events.map((e) => e.step);
    for (const step of [
      "research",
      "claims",
      "strategy:racc_li",
      "writer:racc_li:A",
      "revision:racc_li:B",
      "cross-review:racc_li:A",
      "judge:racc_li",
      "synthesis:racc_li:A",
      "adapt:racc_li:A",
      "checks:racc_li:A.final",
    ]) {
      expect(steps, `missing event for step ${step}`).toContain(step);
    }
  });

  it("truncates what it stores in an event", async () => {
    const { ctx, memory } = setup();
    await runPipelineToCompletion(ctx, "run_1");
    const inputs = memory.events.flatMap((e) => (typeof e.input === "string" ? [e.input] : []));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.length <= 2_100)).toBe(true);
  });

  it("blocks the run when the budget denies a reservation", async () => {
    const { ctx } = setup({ capCents: 0 });
    await expect(runPipelineToCompletion(ctx, "run_1")).rejects.toSatisfy(isPipelineBlocked);
  });

  it("blocks the run when every provider breaker is open", async () => {
    const { ctx } = setup();
    for (const provider of ["OPENAI", "ANTHROPIC", "GOOGLE"] as const) {
      for (let i = 0; i < 5; i++) await ctx.health.recordFailure(provider, "boom");
    }
    await expect(runPipelineToCompletion(ctx, "run_1")).rejects.toThrow(/providers unavailable/);
  });

  it("blocks the run when no draft survives the checks", async () => {
    const { ctx, script } = setup();
    script.failing.add("WRITER");
    await expect(runPipelineToCompletion(ctx, "run_1")).rejects.toThrow(/no valid drafts/);
  });
});

describe("advanceRun", () => {
  it("advances exactly one stage per call", async () => {
    const { ctx, memory } = setup();
    expect(await advanceRun(ctx, "run_1")).toEqual({ status: "RESEARCHING", done: false });
    expect(memory.snapshot().research).toBeDefined();
    expect(await advanceRun(ctx, "run_1")).toEqual({ status: "STRATEGIZING", done: false });
    expect(memory.snapshot().accounts[0]?.strategy).toBeDefined();
  });

  it("returns done for a run that is not in the pipeline", async () => {
    const { ctx, memory } = createTestContext(baseRun({ status: "AWAITING_APPROVAL" }), {});
    expect(await advanceRun(ctx, "run_1")).toEqual({ status: "AWAITING_APPROVAL", done: true });
    expect(memory.statuses).toEqual([]);
  });
});

describe("planWriters", () => {
  it("uses one writer per allow-listed model", () => {
    const { ctx } = setup();
    expect(planWriters(ctx).map((s) => [s.label, s.pref.provider, s.pref.model])).toEqual([
      ["A", "OPENAI", "gpt-test"],
      ["B", "ANTHROPIC", "claude-test"],
    ]);
  });

  it("varies the temperature when a single provider writes every draft", () => {
    const { ctx } = createTestContext(baseRun(), { availableProviders: ["OPENAI"] });
    const slots = planWriters(ctx);
    expect(slots.map((s) => s.label)).toEqual(["A", "B", "C"]);
    expect(slots.map((s) => s.temperature)).toEqual([0.6, 0.8, 1.0]);
  });

  it("ignores allow-list entries for providers without a key", () => {
    const { ctx } = createTestContext(baseRun(), {
      availableProviders: ["OPENAI", "ANTHROPIC"],
      allowedModels: ["GOOGLE::gemini-test", "broken", "OPENAI::gpt-test"],
    });
    expect(planWriters(ctx).map((s) => s.pref)).toEqual([
      { provider: "OPENAI", model: "gpt-test" },
      { provider: "OPENAI", model: "gpt-test" },
      { provider: "OPENAI", model: "gpt-test" },
    ]);
  });
});

describe("judge helpers", () => {
  const drafts = [
    { label: "A", provider: "OPENAI", model: "gpt-test", text: "First", hashtags: ["#a"] },
    { label: "B", provider: "ANTHROPIC", model: "claude-test", text: "Second", hashtags: [] },
  ].map((d) => ({
    ...d,
    role: "WRITER" as const,
    provider: d.provider as "OPENAI",
    promptKey: "writer",
    promptVersion: 1,
    promptHash: "x",
    claimIds: [],
    costCents: 1,
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
  }));

  it("exposes labels and text only", () => {
    expect(buildCandidates(drafts)).toEqual([
      { candidate: "A", text: "First\n\nHashtags: #a" },
      { candidate: "B", text: "Second" },
    ]);
  });

  it("throws when a provider or model name reaches the judge", () => {
    expect(() => assertBlind("Candidate A was written by OPENAI", drafts)).toThrow(/leaked provider identity/);
    expect(() => assertBlind("model: gpt-test", drafts)).toThrow(/leaked provider identity/);
    expect(() => assertBlind("Candidate A: First", drafts)).not.toThrow();
  });

  it("repairs an invalid winner from the scores", () => {
    const verdict = {
      winner: "D",
      scores: [
        { label: "A", score: 30, rationale: "" },
        { label: "B", score: 41, rationale: "" },
      ],
      borrow: [],
    };
    expect(resolveWinner(verdict, ["A", "B"])).toBe("B");
    expect(resolveWinner({ ...verdict, winner: "A" }, ["A", "B"])).toBe("A");
    expect(resolveWinner({ winner: "", scores: [], borrow: [] }, ["A"])).toBe("A");
  });
});

describe("decideNextAfterAdapting", () => {
  const base: PublishPolicy = {
    publishMode: "AUTOMATIC",
    orgMode: "AUTOMATIC",
    creatorCanPublish: true,
    accountsAutoPublish: [true, true],
    checksPassed: true,
    budgetOk: true,
  };

  it("publishes automatically only when every condition holds", () => {
    expect(decideNextAfterAdapting(base)).toBe("APPROVED");
  });

  it("completes a MANUAL run without asking for approval", () => {
    expect(decideNextAfterAdapting({ ...base, publishMode: "MANUAL" })).toBe("COMPLETED");
    expect(decideNextAfterAdapting({ ...base, publishMode: "MANUAL", checksPassed: false })).toBe("COMPLETED");
  });

  it("falls back to approval for every other combination", () => {
    const cases: Partial<PublishPolicy>[] = [
      { publishMode: "APPROVAL_REQUIRED" },
      { orgMode: "APPROVAL_REQUIRED" },
      { orgMode: "MANUAL" },
      { creatorCanPublish: false },
      { accountsAutoPublish: [true, false] },
      { accountsAutoPublish: [] },
      { checksPassed: false },
      { budgetOk: false },
    ];
    for (const override of cases) {
      expect(decideNextAfterAdapting({ ...base, ...override }), JSON.stringify(override)).toBe("AWAITING_APPROVAL");
    }
  });
});
