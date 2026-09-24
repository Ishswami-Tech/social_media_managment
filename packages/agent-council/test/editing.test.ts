import { describe, expect, it } from "vitest";
import { runPipelineToCompletion } from "../src/pipeline";
import { adaptChosenDraft } from "../src/stages/adapt";
import { choosableDraft, reviseRecommendation, RevisionRejected } from "../src/stages/editing";
import { createTestContext } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

async function finished() {
  const { ctx, memory, script } = createTestContext(baseRun({ assurance: "JUDGE_ONLY" }), { allowedModels: ["OPENAI::gpt-test"] });
  await runPipelineToCompletion(ctx, "run_1");
  const snapshot = memory.snapshot();
  const account = snapshot.accounts[0]!;
  return { ctx, memory, script, snapshot, account };
}

describe("reviseRecommendation", () => {
  it("applies the request with the claims ledger and playbooks and returns a checked draft", async () => {
    const { ctx, snapshot, account, script, memory } = await finished();
    const current = { text: account.recommendation!.finalText, hashtags: account.recommendation!.hashtags };

    const revision = await reviseRecommendation({ ...ctx, skillInstructions: "## Skill: House style\nShort." }, snapshot, account, current, "Make it shorter");

    expect(revision.text).toContain("Shorter.");
    expect(revision.note).toBe("Cut it to the point.");
    expect(revision.checks.ok).toBe(true);
    const call = script.calls.find((c) => c.stage === "REVISE REQUEST");
    expect(call?.system).toContain("THE REQUEST\nMake it shorter");
    expect(call?.system).toContain("## Skill: House style");
    expect(call?.system).toContain("ALLOWED CLAIMS");
    expect(memory.events.some((e) => e.step === "revise:racc_li" && e.status === "SUCCEEDED")).toBe(true);
  });

  it("rejects a revision that breaks a rule, with the reasons, and stores nothing", async () => {
    const { ctx, snapshot, account, script, memory } = await finished();
    script.overlongRevision = true;
    const before = memory.recommendations.length;
    const current = { text: account.recommendation!.finalText, hashtags: [] };

    await expect(reviseRecommendation(ctx, snapshot, account, current, "Make it longer")).rejects.toBeInstanceOf(RevisionRejected);
    expect(memory.recommendations).toHaveLength(before);
  });
});

describe("adaptChosenDraft", () => {
  it("overrides the judge with another written draft and runs the platform pass on it", async () => {
    const { ctx, snapshot, account, memory, script } = await finished();
    const other = account.drafts.find((d) => d.role === "WRITER" && d.label !== account.recommendation?.winnerDraftLabel);
    expect(other).toBeDefined();
    expect(choosableDraft(account, other!.id!)).toBeDefined();
    expect(choosableDraft(account, "draft_nope")).toBeUndefined();
    const adaptCallsBefore = script.calls.filter((c) => c.stage === "ADAPT").length;

    const result = await adaptChosenDraft(ctx, snapshot, account, other!);

    expect(result.text.length).toBeGreaterThan(0);
    expect(script.calls.filter((c) => c.stage === "ADAPT")).toHaveLength(adaptCallsBefore + 1);
    const latest = memory.recommendations.at(-1)!;
    expect(latest.winnerDraftId).toBe(other!.id);
    expect(latest.winnerDraftLabel).toBe(other!.label);
    expect(memory.events.some((e) => e.step === `choose-draft:racc_li:${other!.label}`)).toBe(true);
    // No adaptation draft is ever offered as a choice.
    const adaptation = memory.snapshot().accounts[0]!.drafts.find((d) => d.role === "ADAPTATION");
    expect(choosableDraft(memory.snapshot().accounts[0]!, adaptation!.id!)).toBeUndefined();
  });
});
