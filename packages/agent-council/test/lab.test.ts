import { describe, expect, it } from "vitest";
import { parseLabOutput, renderLabPrompt } from "../src/lab";
import { runPipelineToCompletion } from "../src/pipeline";
import { createTestContext } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

const HOUSE_STYLE = "## Skill: House style\nShort.";

describe("prompt lab", () => {
  it("renders a stage prompt from a real account with lanes, claims and playbooks, and checks the answer", async () => {
    const { ctx, memory } = createTestContext(baseRun({ assurance: "JUDGE_ONLY" }), { allowedModels: ["OPENAI::gpt-test"] });
    const labCtx = { ...ctx, skillInstructions: HOUSE_STYLE };
    await runPipelineToCompletion(labCtx, "run_1");
    const snapshot = memory.snapshot();
    const account = snapshot.accounts[0]!;

    const writer = renderLabPrompt("writer", labCtx, snapshot, account, { lane: "C" });
    expect(writer.system).toContain("STAGE: WRITER");
    expect(writer.system).toContain("Contrarian:");
    expect(writer.system).toContain("ALLOWED CLAIMS");
    expect(writer.system).toContain(HOUSE_STYLE);
    expect(writer.json).toBe(true);

    const revise = renderLabPrompt("revise-request", ctx, snapshot, account, { instruction: "Drop the number" });
    expect(revise.system).toContain("THE REQUEST\nDrop the number");
    expect(revise.system).toContain(account.recommendation!.finalText.slice(0, 30));

    const answer = JSON.stringify({ text: "Short and clear.\n\nWhat would you change?", hashtags: ["#onboarding"], claimIds: [] });
    const parsed = parseLabOutput("writer", `Here you go: ${answer}`, ctx, snapshot, account);
    expect(parsed.text).toBe("Short and clear.\n\nWhat would you change?");
    expect(parsed.checks?.ok).toBe(true);
    expect(() => parseLabOutput("writer", "not json at all", ctx, snapshot, account)).toThrow();
    expect(parseLabOutput("strategy", JSON.stringify({ angle: "x" }), ctx, snapshot, account).value).toMatchObject({ angle: "x", hookType: "story" });
  });
});
