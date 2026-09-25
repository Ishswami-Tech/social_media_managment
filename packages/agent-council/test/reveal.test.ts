import { describe, expect, it } from "vitest";
import { revealStages, type ProgressStage, type ProgressStageKey, type ProgressStageState } from "../src/progress";

const stage = (key: ProgressStageKey, state: ProgressStageState): ProgressStage => ({
  key,
  label: key,
  state,
  costCents: 0,
  activity: [],
});

describe("revealStages", () => {
  it("shows who has worked, who is working, and only the next one as a hint", () => {
    const shown = revealStages([
      stage("research", "done"),
      stage("strategy", "done"),
      stage("drafting", "active"),
      stage("review", "pending"),
      stage("judge", "pending"),
      stage("adapt", "pending"),
      stage("ready", "pending"),
    ]);
    expect(shown.map((s) => `${s.stage.key}${s.hint ? "?" : ""}`)).toEqual(["research", "strategy", "drafting", "review?"]);
  });

  it("shows everyone once the run is finished", () => {
    const all: ProgressStageKey[] = ["research", "strategy", "drafting", "review", "judge", "adapt", "ready"];
    const shown = revealStages(all.map((k) => stage(k, "done")));
    expect(shown).toHaveLength(7);
    expect(shown.every((s) => !s.hint)).toBe(true);
  });

  it("stops at a failure without hinting at what would have come next", () => {
    const shown = revealStages([stage("research", "failed"), stage("strategy", "pending"), stage("drafting", "pending")]);
    expect(shown.map((s) => s.stage.key)).toEqual(["research"]);
  });

  it("keeps skipped agents in the trail", () => {
    const shown = revealStages([stage("research", "skipped"), stage("strategy", "active"), stage("drafting", "pending")]);
    expect(shown.map((s) => `${s.stage.key}${s.hint ? "?" : ""}`)).toEqual(["research", "strategy", "drafting?"]);
  });
});
