import { describe, expect, it } from "vitest";
import { buildTranscript, type ProgressAccount, type ProgressEvent } from "../src/progress";

const account: ProgressAccount = {
  runAccountId: "acc_1",
  displayName: "Asha",
  platform: "LINKEDIN",
  decision: "PENDING",
  hasRecommendation: false,
};

const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();
const ev = (id: string, step: string, status: string, s: number, extra: Partial<ProgressEvent> = {}): ProgressEvent => ({
  id,
  step,
  status,
  at: at(s),
  ...extra,
});

describe("buildTranscript", () => {
  it("turns events into one message per agent in time order, with the writer's label and model", () => {
    const events = [
      ev("3", "writer:acc_1:B", "SUCCEEDED", 30, { provider: "ANTHROPIC", model: "claude-haiku-4-5", output: { draft: "Hello" } }),
      ev("1", "research", "STARTED", 0),
      ev("2", "research", "SUCCEEDED", 12, { provider: "GOOGLE", model: "gemini-2.5-flash" }),
    ];
    const messages = buildTranscript(events, [account], { claimCount: 7 });
    expect(messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(messages[0]?.agent).toBe("research");
    expect(messages[0]?.tone).toBe("info");
    expect(messages[1]?.tone).toBe("success");
    expect(messages[2]).toMatchObject({ agent: "drafting", label: "B", model: "claude-haiku-4-5", output: { draft: "Hello" } });
  });

  it("marks failures and drops bookkeeping steps and repeated lines", () => {
    const events = [
      ev("1", "writer:acc_1:A", "FAILED", 1, { error: "quota exhausted. Try later" }),
      ev("2", "budget.reserve", "SUCCEEDED", 2),
      ev("3", "research", "STARTED", 3),
      ev("4", "research", "STARTED", 4),
    ];
    const messages = buildTranscript(events, [account]);
    expect(messages[0]?.tone).toBe("failed");
    expect(messages.some((m) => m.id === "2")).toBe(false);
    expect(messages.filter((m) => m.agent === "research")).toHaveLength(1);
  });

  it("is empty when nothing has happened", () => {
    expect(buildTranscript([], [account])).toEqual([]);
  });
});
