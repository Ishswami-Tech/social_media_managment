import { describe, expect, it } from "vitest";
import { runPipelineToCompletion } from "../src/pipeline";
import { createTestContext } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

const INSTRUCTIONS = "## Skill: House style\nNever open with a question. Always name the customer.";

/** Stages that write or rewrite text must follow the attached skill playbooks. */
const WRITING_STAGES = ["WRITER", "REVISION", "SYNTHESIS", "ADAPT"] as const;

describe("skill instructions", () => {
  it("appends them to the writer system prompt", async () => {
    const { ctx, script } = createTestContext(baseRun(), { allowedModels: ["OPENAI::gpt-test"] });
    await runPipelineToCompletion({ ...ctx, skillInstructions: INSTRUCTIONS }, "run_1");

    const writer = script.calls.filter((c) => c.stage === "WRITER");
    expect(writer.length).toBeGreaterThan(0);
    for (const call of writer) {
      expect(call.system).toContain("===== SKILL INSTRUCTIONS (follow these) =====");
      expect(call.system).toContain(INSTRUCTIONS);
    }
  });

  it("reaches every stage that writes text, and no stage that only reads", async () => {
    const { ctx, script } = createTestContext(baseRun(), { allowedModels: ["OPENAI::gpt-test"] });
    await runPipelineToCompletion({ ...ctx, skillInstructions: INSTRUCTIONS }, "run_1");

    for (const stage of WRITING_STAGES) {
      const calls = script.calls.filter((c) => c.stage === stage);
      expect(calls.length, `no ${stage} call was made`).toBeGreaterThan(0);
      expect(calls.every((c) => c.system.includes(INSTRUCTIONS)), `${stage} lost the instructions`).toBe(true);
    }
    // The blind judge must score on the text alone, so nothing is appended there.
    expect(script.calls.filter((c) => c.stage === "JUDGE").some((c) => c.system.includes(INSTRUCTIONS))).toBe(false);
  });

  it("leaves the prompt untouched when no skills are attached", async () => {
    const { ctx, script } = createTestContext(baseRun(), { allowedModels: ["OPENAI::gpt-test"] });
    await runPipelineToCompletion(ctx, "run_1");

    expect(script.calls.some((c) => c.system.includes("SKILL INSTRUCTIONS"))).toBe(false);
  });
});
