import { describe, expect, it } from "vitest";
import {
  buildProgress,
  buildSummaryLine,
  formatDuration,
  stageOfStep,
  type ProgressAccount,
  type ProgressEvent,
  type ProgressStageKey,
} from "../src/progress";

const ACC = "acc_1";
const ACC_2 = "acc_2";

const accounts: ProgressAccount[] = [
  { runAccountId: ACC, displayName: "Roast House", platform: "LINKEDIN", decision: "PENDING" },
];

const twoAccounts: ProgressAccount[] = [
  ...accounts,
  { runAccountId: ACC_2, displayName: "Roast House X", platform: "X", decision: "PENDING" },
];

let clock = 0;

function event(step: string, status: string, extra: Partial<ProgressEvent> = {}): ProgressEvent {
  clock += 1_000;
  return {
    id: `e${clock}`,
    step,
    status,
    at: new Date(clock).toISOString(),
    ...extra,
  };
}

function stage(
  result: ReturnType<typeof buildProgress>,
  key: ProgressStageKey,
): ReturnType<typeof buildProgress>["stages"][number] {
  const found = result.stages.find((s) => s.key === key);
  if (!found) throw new Error(`no ${key} stage`);
  return found;
}

describe("stageOfStep", () => {
  it("maps every worker step to the stage a person would expect", () => {
    expect(stageOfStep("research")).toBe("research");
    expect(stageOfStep("claims")).toBe("research");
    expect(stageOfStep(`strategy:${ACC}`)).toBe("strategy");
    expect(stageOfStep(`writer:${ACC}:A`)).toBe("drafting");
    expect(stageOfStep(`checks:${ACC}:A`)).toBe("review");
    expect(stageOfStep(`checks:${ACC}:A.revision`)).toBe("review");
    expect(stageOfStep(`revision:${ACC}:B`)).toBe("review");
    expect(stageOfStep(`cross-review:${ACC}:B`)).toBe("review");
    expect(stageOfStep(`draft-dropped:${ACC}:C`)).toBe("review");
    expect(stageOfStep(`judge:${ACC}`)).toBe("judge");
    expect(stageOfStep("judge.verdict")).toBe("judge");
    expect(stageOfStep(`synthesis:${ACC}:A`)).toBe("adapt");
    expect(stageOfStep(`adapt:${ACC}:A`)).toBe("adapt");
    expect(stageOfStep("notify")).toBe("ready");
  });

  it("puts the final check with the adaptation it validates, not with the earlier checks", () => {
    expect(stageOfStep(`checks:${ACC}:A.final`)).toBe("adapt");
  });

  it("ignores bookkeeping steps nobody reads", () => {
    for (const step of ["create", "pause", "resume", "cancel", "retry"]) expect(stageOfStep(step)).toBeNull();
  });
});

describe("buildProgress: seven stages", () => {
  it("always returns the seven stages in order", () => {
    const result = buildProgress("QUEUED", [], accounts);
    expect(result.stages.map((s) => s.key)).toEqual([
      "research",
      "strategy",
      "drafting",
      "review",
      "judge",
      "adapt",
      "ready",
    ]);
  });

  it("uses the run status to place the active stage when no events exist yet", () => {
    const result = buildProgress("DRAFTING", [], accounts);
    expect(stage(result, "drafting").state).toBe("active");
    expect(stage(result, "judge").state).toBe("pending");
    // Nothing was recorded for the earlier stages, so they are skipped, not done.
    expect(stage(result, "research").state).toBe("skipped");
  });

  it("counts finished stages towards the percentage, out of seven", () => {
    const events = [event("research", "SUCCEEDED"), event("claims", "SUCCEEDED"), event(`strategy:${ACC}`, "SUCCEEDED")];
    const result = buildProgress("DRAFTING", events, accounts);
    expect(stage(result, "research").state).toBe("done");
    expect(stage(result, "strategy").state).toBe("done");
    expect(result.overall.percent).toBe(Math.round((2 / 7) * 100));
  });

  it("reaches 100% only once the last stage is done", () => {
    const events = [
      event("research", "SUCCEEDED"),
      event("claims", "SUCCEEDED"),
      event(`strategy:${ACC}`, "SUCCEEDED"),
      event(`writer:${ACC}:A`, "SUCCEEDED"),
      event(`checks:${ACC}:A`, "SUCCEEDED"),
      event(`judge:${ACC}`, "SUCCEEDED"),
      event(`adapt:${ACC}:A`, "SUCCEEDED"),
      event("notify", "SUCCEEDED"),
    ];
    const result = buildProgress("AWAITING_APPROVAL", events, accounts);
    expect(stage(result, "ready").state).toBe("done");
    expect(result.overall.percent).toBe(100);
    expect(result.overall.label).toBe("Ready for your review");
  });
});

describe("buildProgress: activity lines", () => {
  it("describes the research stage, naming the number of facts when it is known", () => {
    const events = [event("research", "STARTED"), event("claims", "SUCCEEDED")];
    expect(stage(buildProgress("RESEARCHING", events, accounts, { claimCount: 5 }), "research").activity).toEqual([
      "Reading sources…",
      "Recording 5 facts",
    ]);
  });

  it("stays vague about the facts when the count was not supplied", () => {
    const events = [event("claims", "SUCCEEDED")];
    expect(stage(buildProgress("RESEARCHING", events, accounts), "research").activity).toEqual(["Facts recorded"]);
  });

  it("names the account whose angle was chosen", () => {
    const events = [event(`strategy:${ACC}`, "SUCCEEDED")];
    expect(stage(buildProgress("STRATEGIZING", events, accounts), "strategy").activity).toEqual([
      "Angle chosen for Roast House",
    ]);
  });

  it("shows who is writing, with the provider, and how long each writer took", () => {
    const events = [
      event(`writer:${ACC}:A`, "STARTED", { provider: "ANTHROPIC" }),
      event(`writer:${ACC}:A`, "SUCCEEDED", { provider: "ANTHROPIC", latencyMs: 4_120 }),
    ];
    expect(stage(buildProgress("DRAFTING", events, accounts), "drafting").activity).toEqual([
      "Writer A drafting via Anthropic…",
      "Writer A done · 4.1 s",
    ]);
  });

  it("adds the account name to the writer line only when several accounts are running", () => {
    const events = [event(`writer:${ACC_2}:B`, "STARTED", { provider: "OPENAI" })];
    expect(stage(buildProgress("DRAFTING", events, twoAccounts), "drafting").activity).toEqual([
      "Writer B drafting for Roast House X via OpenAI…",
    ]);
  });

  it("reports fixes and drops during the checks, with the reason for a drop", () => {
    const events = [
      event(`checks:${ACC}:B`, "FAILED"),
      event(`revision:${ACC}:B`, "SUCCEEDED"),
      event(`checks:${ACC}:C`, "FAILED"),
      event(`draft-dropped:${ACC}:C`, "SKIPPED", { error: "cites a source we could not verify" }),
    ];
    expect(stage(buildProgress("REVIEWING", events, accounts), "review").activity).toEqual([
      "Draft B needs a fix",
      "Draft B fixed",
      "Draft C needs a fix",
      "Draft C dropped: cites a source we could not verify",
    ]);
  });

  it("counts the drafts the judge is scoring and names the winner", () => {
    const events = [
      event(`writer:${ACC}:A`, "SUCCEEDED"),
      event(`writer:${ACC}:B`, "SUCCEEDED"),
      event(`writer:${ACC}:C`, "SUCCEEDED"),
      event(`judge:${ACC}`, "STARTED"),
      event("judge.verdict", "SUCCEEDED", { output: { winner: "A" } }),
    ];
    const activity = stage(buildProgress("JUDGING", events, accounts), "judge").activity;
    expect(activity).toContain("Scoring 3 drafts…");
    expect(activity).toContain("Winner: draft A");
  });

  it("does not count drafts that were dropped before the judge saw them", () => {
    const events = [
      event(`writer:${ACC}:A`, "SUCCEEDED"),
      event(`writer:${ACC}:B`, "SUCCEEDED"),
      event(`writer:${ACC}:C`, "SUCCEEDED"),
      event(`draft-dropped:${ACC}:C`, "SKIPPED", { error: "too long" }),
      event(`judge:${ACC}`, "STARTED"),
    ];
    expect(stage(buildProgress("JUDGING", events, accounts), "judge").activity).toContain("Scoring 2 drafts…");
  });

  it("omits the winner line when the verdict carried no output", () => {
    const events = [event("judge.verdict", "SUCCEEDED")];
    expect(stage(buildProgress("JUDGING", events, accounts), "judge").activity).toEqual([]);
  });

  it("names the platform it is adapting for", () => {
    const events = [event(`adapt:${ACC}:A`, "STARTED"), event(`checks:${ACC}:A.final`, "SUCCEEDED")];
    const adapt = stage(buildProgress("ADAPTING", events, accounts), "adapt");
    expect(adapt.label).toBe("Adapting for LinkedIn");
    expect(adapt.activity).toEqual(["Shaping it for LinkedIn…", "Final check passed"]);
  });

  it("falls back to a generic label when more than two platforms are involved", () => {
    const many: ProgressAccount[] = [
      ...twoAccounts,
      { runAccountId: "acc_3", displayName: "Roast House IG", platform: "INSTAGRAM" },
    ];
    expect(stage(buildProgress("ADAPTING", [], many), "adapt").label).toBe("Adapting for each platform");
  });
});

describe("buildProgress: timing, cost and halted runs", () => {
  it("records when a finished stage started and how long it took", () => {
    const start = event("research", "STARTED");
    const end = event("claims", "SUCCEEDED");
    const result = buildProgress("STRATEGIZING", [start, end], accounts);
    const research = stage(result, "research");
    expect(research.startedAt).toBe(start.at);
    expect(research.finishedAt).toBe(end.at);
    expect(research.durationMs).toBe(Date.parse(end.at) - Date.parse(start.at));
  });

  it("leaves an unfinished stage without an end or a duration", () => {
    const result = buildProgress("RESEARCHING", [event("research", "STARTED")], accounts);
    expect(stage(result, "research").finishedAt).toBeUndefined();
    expect(stage(result, "research").durationMs).toBeUndefined();
  });

  it("adds up what each stage cost", () => {
    const events = [
      event(`writer:${ACC}:A`, "SUCCEEDED", { costCents: 1.5 }),
      event(`writer:${ACC}:B`, "SUCCEEDED", { costCents: 2 }),
    ];
    expect(stage(buildProgress("DRAFTING", events, accounts), "drafting").costCents).toBeCloseTo(3.5);
  });

  it("marks the stage that was running when the run failed", () => {
    const events = [event("research", "SUCCEEDED"), event(`writer:${ACC}:A`, "FAILED", { error: "provider down" })];
    const result = buildProgress("FAILED", events, accounts);
    expect(stage(result, "drafting").state).toBe("failed");
    expect(result.overall.label).toBe("Something went wrong");
  });

  it("uses plain wording for the side states", () => {
    expect(buildProgress("PAUSED", [], accounts).overall.label).toBe("Paused");
    expect(buildProgress("BLOCKED", [], accounts).overall.label).toBe("Needs your attention");
    expect(buildProgress("CANCELLED", [], accounts).overall.label).toBe("Stopped");
  });

  it("sorts events it receives out of order", () => {
    const first = event("research", "STARTED");
    const second = event("claims", "SUCCEEDED");
    const result = buildProgress("STRATEGIZING", [second, first], accounts);
    expect(stage(result, "research").startedAt).toBe(first.at);
  });

  it("never leaks internal vocabulary into a label", () => {
    const result = buildProgress("DRAFTING", [event(`writer:${ACC}:A`, "STARTED")], accounts);
    const text = [result.overall.label, ...result.stages.flatMap((s) => [s.label, ...s.activity])].join(" ").toLowerCase();
    for (const word of ["pipeline", "council", "runaccount", ACC]) expect(text).not.toContain(word);
  });
});

describe("formatDuration and buildSummaryLine", () => {
  it("reads durations the way a person says them", () => {
    expect(formatDuration(4_120)).toBe("4.1 s");
    expect(formatDuration(151_000)).toBe("2m 31s");
    expect(formatDuration(0)).toBe("0.0 s");
  });

  it("writes the one-line summary of a finished campaign", () => {
    expect(
      buildSummaryLine({ sourceCount: 5, draftCount: 3, judged: true, adapted: true, durationMs: 151_000, spentCents: 14 }),
    ).toBe("Researched 5 sources · 3 drafts · judged · adapted in 2m 31s for $0.14");
  });

  it("drops the parts that did not happen", () => {
    expect(
      buildSummaryLine({ sourceCount: 1, draftCount: 1, judged: false, adapted: false, durationMs: 0, spentCents: 0 }),
    ).toBe("Researched 1 source · 1 draft");
  });
});
