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

/**
 * A playbook that carries its own data is one document. Cut in the middle it
 * hands the model half a JSON object as though it were whole, which is worse
 * than leaving it out.
 */
describe("a playbook longer than the prompt allows", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `  { "id": ${i}, "template": "line ${i}" },`).join("\n");

  it("is cut at a line, never mid-structure, and says it was cut", async () => {
    const { ctx, memory, script } = createTestContext(baseRun(), {
      allowedModels: ["OPENAI::gpt-test", "ANTHROPIC::claude-test"],
      skills: [
        {
          id: "custom:big",
          name: "Hooks",
          description: "many formulas",
          instructions: `# Hooks\n\n${lines(2000)}`,
          platforms: [],
          always: true,
        },
      ],
    });
    await runPipelineToCompletion(ctx, "run_1").catch(() => undefined);

    const writer = script.calls.find((c) => c.stage === "WRITER");
    expect(writer, "a writer call should have happened").toBeTruthy();
    const system = writer!.system;
    expect(system).toContain("[truncated: this playbook is longer than the prompt allows]");
    // The cut lands on a line break, so the last thing the model sees is whole.
    const beforeMarker = system.slice(0, system.indexOf("[truncated")).trimEnd();
    expect(beforeMarker.endsWith(",")).toBe(true);
    void memory;
  });
});
