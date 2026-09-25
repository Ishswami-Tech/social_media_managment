import { describe, expect, it } from "vitest";
import { buildBoard, modelLabel, progressOutput, type ProgressAccount, type ProgressEvent } from "../src/progress";

const ACC = "racc_li";
const accounts: ProgressAccount[] = [{ runAccountId: ACC, displayName: "Northwind", platform: "LINKEDIN" }];

let tick = 0;
function event(step: string, status: string, extra: Partial<ProgressEvent> = {}): ProgressEvent {
  tick += 1;
  return { id: `e${tick}`, step, status, at: new Date(1_700_000_000_000 + tick * 1000).toISOString(), ...extra };
}

describe("modelLabel", () => {
  it("turns model ids into names people recognise", () => {
    expect(modelLabel("gemini-2.5-flash", "GOOGLE")).toBe("Gemini 2.5 Flash");
    expect(modelLabel("claude-fable-5-1", "ANTHROPIC")).toBe("Claude Fable 5.1");
    expect(modelLabel("gpt-5-mini", "OPENAI")).toBe("GPT 5 Mini");
    expect(modelLabel("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
    expect(modelLabel("claude-fable-5-1[1m]", "ANTHROPIC")).toBe("Claude Fable 5.1 1M");
    expect(modelLabel(undefined, "GOOGLE")).toBe("Google");
    expect(modelLabel(undefined)).toBeUndefined();
  });
});

describe("progressOutput", () => {
  it("previews the text inside a writing step's stored JSON, even when truncated", () => {
    const stored = '{"text": "First line\\n\\nSecond \\"quoted\\" line", "hashtags": ["#a"], "claimIds": []}';
    expect(progressOutput("writer:racc_li:A", stored)).toEqual({ draft: 'First line\n\nSecond "quoted" line' });
    expect(progressOutput("adapt:racc_li:A", '{"text": "Cut off mid')).toBeUndefined();
    expect(progressOutput("writer:racc_li:A", { not: "a string" })).toBeUndefined();
  });

  it("passes the judge's winner and scores, playbook names and review verdicts, and nothing else", () => {
    expect(progressOutput("judge.verdict", { winner: "B", scores: [{ label: "A", score: 40, rationale: "ok" }, { label: "B", score: 51 }, { bad: true }] })).toEqual({
      winner: "B",
      scores: [
        { label: "A", score: 40, rationale: "ok" },
        { label: "B", score: 51 },
      ],
    });
    expect(progressOutput("skills", { skills: ["A", 3, "B"], chosen: [] })).toEqual({ skills: ["A", "B"] });
    expect(progressOutput("review:racc_li:A", { verdict: "PASS", issues: [], fixed: false })).toEqual({ verdict: "PASS", issues: [], fixed: false });
    expect(progressOutput("research", { anything: 1 })).toBeUndefined();
  });
});

describe("buildBoard", () => {
  it("seats each agent with its model and tracks every writer's draft, review and score", () => {
    const events = [
      event("research", "STARTED", { provider: "GOOGLE", model: "gemini-2.5-flash" }),
      event("research", "SUCCEEDED", { provider: "GOOGLE", model: "gemini-2.5-flash", latencyMs: 9000 }),
      event(`strategy:${ACC}`, "SUCCEEDED", { provider: "GOOGLE", model: "gemini-2.5-flash" }),
      event(`writer:${ACC}:A`, "STARTED", { provider: "ANTHROPIC", model: "claude-fable-5-1" }),
      event(`writer:${ACC}:B`, "STARTED", { provider: "GOOGLE", model: "gemini-2.5-flash" }),
      event(`writer:${ACC}:A`, "SUCCEEDED", { provider: "ANTHROPIC", model: "claude-fable-5-1", latencyMs: 8000, output: { draft: "Draft A text" } }),
      event(`review:${ACC}:A`, "SUCCEEDED", { provider: "GOOGLE", model: "gemini-2.5-flash", output: { verdict: "REVISE", issues: ["x", "y"], fixed: true } }),
      event(`revision:${ACC}:A.review-fix`, "SUCCEEDED", { provider: "ANTHROPIC", model: "claude-fable-5-1", output: { draft: "Draft A fixed" } }),
      event("judge.verdict", "SUCCEEDED", { output: { winner: "A", scores: [{ label: "A", score: 48, rationale: "concrete" }, { label: "B", score: 30 }] } }),
    ];
    const board = buildBoard("JUDGING", events, accounts);

    const researcher = board.seats.find((s) => s.role === "research")!;
    expect(researcher.modelLabel).toBe("Gemini 2.5 Flash");
    expect(researcher.state).toBe("done");
    expect(researcher.latencyMs).toBe(9000);

    const [a, b] = board.writers;
    expect(a).toMatchObject({ name: "Writer A", modelLabel: "Claude Fable 5.1", state: "done", draft: "Draft A fixed", reviewVerdict: "REVISE", reviewIssues: 2, score: 48, rationale: "concrete", winner: true });
    expect(a!.detail).toBe("Fixed after the platform review");
    expect(b).toMatchObject({ name: "Writer B", modelLabel: "Gemini 2.5 Flash", state: "active", score: 30, winner: false });
    expect(b!.draft).toBeUndefined();

    expect(board.modelsByStage.research).toBe("Gemini 2.5 Flash");
    expect(board.modelsByStage.drafting).toBe("2 models");
    expect(board.modelsByStage.review).toBe("Gemini 2.5 Flash");
  });

  it("starts empty for a queued run", () => {
    const board = buildBoard("QUEUED", [], accounts);
    expect(board.writers).toEqual([]);
    expect(board.seats.map((s) => s.state)).toEqual(["active", "pending", "pending", "pending", "pending"]);
    expect(board.modelsByStage).toEqual({});
  });
});
