import { describe, expect, it } from "vitest";
import type { SkillCard } from "../src/contracts";
import { runPipelineToCompletion } from "../src/pipeline";
import { candidateSkills, mergeSkillIds, pickSkillsByRule } from "../src/stages/skills";
import { skillInstructionsFor } from "../src/stages/shared";
import { createTestContext, WRITER_TEXTS } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

const card = (id: string, name: string, description: string, extra: Partial<SkillCard> = {}): SkillCard => ({
  id: `custom:${id}`,
  name,
  description,
  platforms: [],
  always: false,
  instructions: `## ${name} rules\nFollow the ${name} playbook.`,
  ...extra,
});

const LI_WRITER = card("linkedin-post-writer", "LinkedIn post writer", "Draft a new LinkedIn post from a hook formula", {
  platforms: ["LINKEDIN"],
});
const LI_COMMENTS = card("linkedin-comment-drafter", "LinkedIn comment drafter", "Draft a LinkedIn comment on a post", {
  platforms: ["LINKEDIN"],
});
const HUMANIZER = card("humanizer", "Humanizer", "Remove the AI tells readers react to in a post");
const HOUSE = card("house-style", "House style", "Never open with a question", { always: true });
const IG_CAPTIONS = card("instagram-captions", "Instagram captions", "Write Instagram captions", { platforms: ["INSTAGRAM"] });
const X_THREADS = card("x-threads", "X threads", "Write X threads", { platforms: ["X"] });

const CATALOGUE = [LI_WRITER, LI_COMMENTS, HUMANIZER, HOUSE, IG_CAPTIONS, X_THREADS];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("skill selection helpers", () => {
  it("offers only playbooks relevant to a target platform", () => {
    expect(candidateSkills(CATALOGUE, ["LINKEDIN"]).map((c) => c.id)).toEqual([
      LI_WRITER.id,
      LI_COMMENTS.id,
      HUMANIZER.id,
      HOUSE.id,
    ]);
  });

  it("falls back to writing playbooks only, never other jobs", () => {
    expect(pickSkillsByRule([LI_COMMENTS, LI_WRITER, HUMANIZER]).map((c) => c.id)).toEqual([
      LI_WRITER.id,
      HUMANIZER.id,
    ]);
  });

  it("keeps manual picks first, then always, then automatic, without duplicates", () => {
    expect(mergeSkillIds(["a", "b"], ["c", "a"], ["b", "d"], 3)).toEqual(["a", "b", "c"]);
  });

  it("injects the chosen and always playbooks for the platform, in that order", () => {
    const { ctx } = createTestContext(baseRun(), { skills: CATALOGUE });
    const run = baseRun({ skillIds: [HUMANIZER.id, LI_WRITER.id] });
    const text = skillInstructionsFor(ctx, run, "LINKEDIN") ?? "";
    expect(text.indexOf("## Skill: Humanizer")).toBeLessThan(text.indexOf("## Skill: LinkedIn post writer"));
    expect(text).toContain("## Skill: House style");
    expect(text).not.toContain("Instagram captions");
    expect(skillInstructionsFor(ctx, run, "INSTAGRAM")).not.toContain("LinkedIn post writer");
  });
});

describe("skills step in the pipeline", () => {
  it("asks the planner, records the choice on the run and hands each platform its own playbooks", async () => {
    const { ctx, memory, script } = createTestContext(baseRun(), {
      allowedModels: ["OPENAI::gpt-test"],
      skills: CATALOGUE,
    });
    script.skillPicks = [LI_WRITER.id, "custom:not-a-real-skill", IG_CAPTIONS.id];

    await runPipelineToCompletion(ctx, "run_1");

    const planner = script.calls.filter((c) => c.stage === "SKILLS");
    expect(planner).toHaveLength(1);
    expect(planner[0]!.system).toContain(LI_WRITER.id);
    expect(planner[0]!.system).not.toContain(X_THREADS.id);
    expect(memory.snapshot().skillIds).toEqual([HOUSE.id, LI_WRITER.id, IG_CAPTIONS.id]);
    const chosen = memory.events.find((e) => e.step === "skills" && isRecord(e.output) && "skills" in e.output);
    expect((chosen?.output as { skills: string[] }).skills).toEqual(["House style", "LinkedIn post writer", "Instagram captions"]);

    const liWriters = script.calls.filter((c) => c.stage === "WRITER" && c.system.includes("PLATFORM: LINKEDIN"));
    expect(liWriters.length).toBeGreaterThan(0);
    for (const call of liWriters) {
      expect(call.system).toContain("## Skill: LinkedIn post writer");
      expect(call.system).toContain("## Skill: House style");
      expect(call.system).not.toContain("Instagram captions");
    }
    const igWriters = script.calls.filter((c) => c.stage === "WRITER" && c.system.includes("PLATFORM: INSTAGRAM"));
    expect(igWriters.every((c) => c.system.includes("## Skill: Instagram captions"))).toBe(true);
    expect(igWriters.every((c) => !c.system.includes("LinkedIn post writer"))).toBe(true);
    // The platform reviewer judges against the same playbooks; the blind judge sees none.
    expect(script.calls.filter((c) => c.stage === "PLATFORM REVIEW").every((c) => c.system.includes("## Skill:"))).toBe(true);
    expect(script.calls.filter((c) => c.stage === "JUDGE").some((c) => c.system.includes("## Skill:"))).toBe(false);
  });

  it("keeps what the person picked by hand", async () => {
    const { ctx, memory, script } = createTestContext(baseRun({ skillIds: [HUMANIZER.id] }), { skills: CATALOGUE });
    script.skillPicks = [];
    await runPipelineToCompletion(ctx, "run_1");
    expect(memory.snapshot().skillIds).toEqual([HUMANIZER.id, HOUSE.id]);
  });

  it("skips the planner call when there is no catalogue", async () => {
    const { ctx, memory, script } = createTestContext(baseRun(), {});
    await runPipelineToCompletion(ctx, "run_1");
    expect(script.calls.some((c) => c.stage === "SKILLS")).toBe(false);
    expect(memory.snapshot().skillIds).toEqual([]);
  });
});

describe("platform review", () => {
  it("fixes a draft the platform reader sends back and judges the fixed version", async () => {
    const { ctx, memory, script } = createTestContext(baseRun({ assurance: "JUDGE_ONLY" }), {
      allowedModels: ["OPENAI::gpt-test"],
    });
    // Draft A (the clean one) is sent back by the reviewer; draft B already gets a deterministic fix.
    script.reviseOnReview = [WRITER_TEXTS[0].slice(0, 40)];

    await runPipelineToCompletion(ctx, "run_1");

    const steps = memory.events.map((e) => e.step);
    expect(steps).toContain("review:racc_li:A");
    expect(steps).toContain("revision:racc_li:A.review-fix");
    expect(steps).toContain("checks:racc_li:A.review-fix");
    const reviewed = memory.events.find((e) => e.step === "review:racc_li:A" && isRecord(e.output) && "verdict" in e.output);
    expect(reviewed?.output).toMatchObject({ verdict: "REVISE", fixed: true });
    // Every survivor is reviewed, in both assurance modes.
    expect(script.calls.filter((c) => c.stage === "PLATFORM REVIEW").length).toBeGreaterThanOrEqual(2);
    // The judge sees the reviewer's notes and the run still completes.
    expect(memory.snapshot().accounts[0]?.reviewNotes?.some((n) => n.label === "A")).toBe(true);
    expect(memory.recommendations).toHaveLength(2);
  });
});
