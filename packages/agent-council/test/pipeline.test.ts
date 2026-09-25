import { describe, expect, it } from "vitest";
import { AI_PROVIDERS } from "@platform/types";
import {
  advanceRun,
  decideNextAfterAdapting,
  interruptedStage,
  runPipelineToCompletion,
  stepDone,
  type PublishPolicy,
} from "../src/pipeline";
import { isPipelineBlocked } from "../src/errors";
import { createCircuitBreaker } from "../src/circuit-breaker";
import { buildBoard, type ProgressEvent } from "../src/progress";
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

  it("reviews every draft as a platform reader on another provider and judges blind on a provider that did not write", async () => {
    const { ctx, memory, script } = setup();
    await runPipelineToCompletion(ctx, "run_1");

    const reviews = script.calls.filter((c) => c.stage === "PLATFORM REVIEW");
    expect(reviews.length).toBeGreaterThan(0);
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
      expect(event.promptVersion).toBeGreaterThanOrEqual(1);
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
      "review:racc_li:A",
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

  it("hands a call to another provider when the first one is out of quota", async () => {
    const { ctx, memory, script } = setup();
    script.outOfQuota.add("GOOGLE");

    await expect(runPipelineToCompletion(ctx, "run_1")).resolves.toEqual({ status: "ADAPTING", done: true });

    const research = memory.events.filter((e) => e.step === "research" && e.promptKey);
    // Both Google models are tried (quota is per provider, but the call cannot know that), then another provider.
    expect(research.map((e) => e.status)).toEqual(["STARTED", "FAILED", "STARTED", "STARTED", "FAILED", "STARTED", "STARTED", "SUCCEEDED"]);
    expect(research.slice(0, 6).every((e) => e.provider === "GOOGLE")).toBe(true);
    expect(research[6]!.provider).not.toBe("GOOGLE");
    expect(research[7]!.provider).toBe(research[6]!.provider);
    expect(research[1]!.error).toMatch(/quota exceeded/);
    expect(String(research[2]!.validation)).toMatch(/trying another model/);
    expect(String(research[5]!.validation)).toMatch(/trying another provider/);
    expect(memory.recommendations).toHaveLength(2);
    // Every auto-routed call tries Google first until the breaker opens (5 failures), then skips it.
    const googleCalls = script.calls.filter((c) => c.provider === "GOOGLE").length;
    expect(googleCalls).toBeGreaterThanOrEqual(1);
    expect(googleCalls).toBeLessThanOrEqual(5);
    expect(memory.events.filter((e) => e.provider === "GOOGLE" && e.status === "SUCCEEDED")).toHaveLength(0);
  });

  it("tries the provider's next model before leaving the provider", async () => {
    const { ctx, memory, script } = createTestContext(baseRun(), {
      allowedModels: ["OPENAI::gpt-test"],
      availableProviders: ["GOOGLE", "OPENAI"],
    });
    script.brokenModels.add("GOOGLE::gemini-test");

    await expect(runPipelineToCompletion(ctx, "run_1")).resolves.toEqual({ status: "ADAPTING", done: true });

    const research = memory.events.filter((e) => e.step === "research" && e.promptKey);
    expect(research.slice(0, 2).map((e) => [e.status, e.model])).toEqual([
      ["STARTED", "gemini-test"],
      ["FAILED", "gemini-test"],
    ]);
    expect(String(research[2]!.validation)).toMatch(/trying another model/);
    expect(research[3]).toMatchObject({ status: "STARTED", provider: "GOOGLE", model: "gemini-test-2" });
    expect(research[4]!.status).toBe("SUCCEEDED");
  });

  it("puts every writer on a different model and keeps them apart when one fails over", async () => {
    const { ctx, script } = createTestContext(baseRun(), { availableProviders: ["GOOGLE", "OPENAI", "ANTHROPIC"] });
    expect(planWriters(ctx).map((s) => `${s.pref.provider}::${s.pref.model}`)).toEqual([
      "GOOGLE::gemini-test",
      "OPENAI::gpt-test",
      "ANTHROPIC::claude-test",
    ]);
    // Google's first model is broken: writer A moves to Google's second model, not to a sibling's model.
    script.brokenModels.add("GOOGLE::gemini-test");
    await runPipelineToCompletion(ctx, "run_1");
    const writers = script.calls.filter((c) => c.stage === "WRITER" && c.system.includes("PLATFORM: LINKEDIN"));
    const used = writers.map((c) => `${c.provider}::${c.model}`);
    expect(used).toContain("GOOGLE::gemini-test-2");
    expect(new Set(used.filter((m) => m !== "GOOGLE::gemini-test")).size).toBe(3);
    expect(writers.some((c) => c.system.includes("YOUR LANE") && c.system.includes("Story:"))).toBe(true);
    expect(writers.some((c) => c.system.includes("Contrarian:"))).toBe(true);
  });

  it("seats a council of three behind the researcher, strategist, reviewer and judge when asked", async () => {
    const { ctx, script, memory } = setup();
    ctx.councilSize = 3;
    await runPipelineToCompletion(ctx, "run_1");
    const stages = (stage: string) => script.calls.filter((c) => c.stage === stage);
    expect(stages("RESEARCH").length).toBe(3);
    expect(new Set(stages("RESEARCH").map((c) => c.provider)).size).toBe(3);
    const accounts = memory.snapshot().accounts.length;
    expect(stages("STRATEGY").length).toBe(3 * accounts);
    // Four models in the fake org and three on each account's writers: the bench seats fewer than three blind judges.
    expect(stages("JUDGE").length).toBeGreaterThanOrEqual(accounts);
    expect(stages("JUDGE").length).toBeLessThan(3 * accounts);
    expect(memory.snapshot().research).toBeDefined();
    expect(memory.snapshot().accounts[0]?.strategy?.alternatives?.length).toBe(2);
    // Each seat has its own step, so the board and the live text keep them apart.
    const researchSteps = new Set(memory.events.filter((e) => e.step.startsWith("research")).map((e) => e.step));
    expect([...researchSteps].sort()).toEqual(["research:m1", "research:m2", "research:m3"]);
    const progressEvents: ProgressEvent[] = memory.events.map((e, i) => ({
      id: `ev_${i}`,
      step: e.step,
      status: e.status,
      provider: e.provider,
      model: e.model,
      at: new Date(i).toISOString(),
    }));
    const board = buildBoard("COMPLETED", progressEvents, []);
    // Three briefs plus the facts pass: the researcher's bench lists every model that sat.
    expect(board.seats.find((s) => s.role === "research")?.models?.length).toBeGreaterThanOrEqual(3);
    expect(board.modelsByStage.research).toMatch(/^\d models$/);
  });

  it("spreads the team over a provider's models instead of everyone using the top one", async () => {
    const { ctx, script } = setup({ availableProviders: ["GOOGLE"] });
    await runPipelineToCompletion(ctx, "run_1");
    const models = script.calls.map((c) => c.model);
    expect(new Set(models)).toEqual(new Set(["gemini-test", "gemini-test-2"]));
    // The first two agents take the two models in turn rather than both taking the first.
    expect(models.slice(0, 2)).toEqual(["gemini-test", "gemini-test-2"]);
  });

  it("settles a half-open probe that lands on a broken model instead of leaving the provider locked", async () => {
    let at = 1_000_000;
    const breaker = createCircuitBreaker({ failureThreshold: 2, windowMs: 60_000, openMs: 1_000 }, () => at);
    const { ctx, script } = createTestContext(baseRun({ accounts: [baseRun().accounts[0]!] }), { availableProviders: ["GOOGLE", "OPENAI"] });
    ctx.health = breaker;
    await breaker.recordFailure("GOOGLE", "quota");
    await breaker.recordFailure("GOOGLE", "quota");
    at += 5_000;
    script.brokenModels.add("GOOGLE::gemini-test");
    script.brokenModels.add("GOOGLE::gemini-test-2");
    await runPipelineToCompletion(ctx, "run_1");
    // The probe hit a model that cannot take the call; the provider itself is fine and the breaker knows it.
    expect(breaker.snapshot("GOOGLE").state).toBe("CLOSED");
    expect(ctx.deadModels?.has("GOOGLE::gemini-test")).toBe(true);
  });

  it("spreads writers over different providers when their planned provider is down", async () => {
    const { ctx, script } = createTestContext(baseRun({ accounts: [baseRun().accounts[0]!] }), {
      availableProviders: ["GOOGLE", "OPENAI", "ANTHROPIC"],
    });
    script.outOfQuota.add("GOOGLE");
    await runPipelineToCompletion(ctx, "run_1");
    const writers = script.calls.filter((c) => c.stage === "WRITER");
    const providers = writers.map((c) => c.provider);
    // Three writers, two live providers: at most one pair may share a provider, and none may sit on Google.
    expect(providers).not.toContain("GOOGLE");
    expect(new Set(providers).size).toBe(2);
    // Writers run side by side, so the order of their calls is not fixed; each lane is used exactly once.
    expect(writers.map((c) => c.system.match(/YOUR LANE[^\n]*\n(\w+):/)?.[1]).sort()).toEqual(["Contrarian", "Evidence", "Story"]);
  });

  it("fails the call when every provider is out of quota", async () => {
    const { ctx, script } = setup();
    for (const provider of ctx.availableProviders) script.outOfQuota.add(provider);
    await expect(runPipelineToCompletion(ctx, "run_1")).rejects.toThrow(/quota exceeded/);
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

describe("interrupted stages", () => {
  it("re-runs a stage whose checkpoint is not done instead of skipping it", async () => {
    expect(interruptedStage({ status: "ADAPTING", currentStep: "ADAPTING:running" })).toBe("ADAPTING");
    expect(interruptedStage({ status: "ADAPTING", currentStep: stepDone("ADAPTING") })).toBeUndefined();
    expect(interruptedStage({ status: "AWAITING_APPROVAL", currentStep: null })).toBeUndefined();

    const { ctx, memory } = setup();
    await runPipelineToCompletion(ctx, "run_1");
    const before = memory.recommendations.length;
    expect(memory.snapshot().currentStep).toBe(stepDone("ADAPTING"));

    // Simulate a worker crash mid-adaptation: the checkpoint is left at "running".
    await memory.store.markStep("run_1", "ADAPTING:running");
    const result = await advanceRun(ctx, "run_1");

    expect(result).toEqual({ status: "ADAPTING", done: true });
    expect(memory.statuses.filter((s) => s === "ADAPTING")).toHaveLength(1);
    expect(memory.recommendations.length).toBe(before * 2);
    expect(memory.snapshot().currentStep).toBe(stepDone("ADAPTING"));
  });

  it("moves on when the checkpoint says the stage finished", async () => {
    const { ctx, memory } = setup();
    await runPipelineToCompletion(ctx, "run_1");
    const before = memory.recommendations.length;
    const result = await advanceRun(ctx, "run_1");
    expect(result).toEqual({ status: "ADAPTING", done: true });
    expect(memory.recommendations.length).toBe(before);
  });
});
