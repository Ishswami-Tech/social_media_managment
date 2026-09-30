import { describe, expect, it } from "vitest";
import { perAccount } from "../src/stages/shared";
import { isRetiredModel } from "../src/stages/call";
import { PipelineBlocked } from "../src/errors";
import { AIError } from "@platform/ai-core";

const accounts = [{ runAccountId: "a" }, { runAccountId: "b" }, { runAccountId: "c" }] as never[];

describe("the accounts of a run", () => {
  it("are worked at the same time, not one after another", async () => {
    let running = 0;
    let atOnce = 0;
    await perAccount(accounts, async () => {
      running += 1;
      atOnce = Math.max(atOnce, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
    });
    expect(atOnce).toBe(3);
  });

  it("come back in the order they were given, whatever order they finish in", async () => {
    const delays = [30, 5, 15];
    const out = await perAccount(accounts, async (_a, ...rest) => {
      const i = accounts.indexOf(_a as never);
      void rest;
      await new Promise((r) => setTimeout(r, delays[i]));
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it("stops everything when the pipeline is blocked", async () => {
    await expect(
      perAccount(accounts, async (a) => {
        if ((a as { runAccountId: string }).runAccountId === "b") throw new PipelineBlocked("budget exhausted");
        return 1;
      }),
    ).rejects.toBeInstanceOf(PipelineBlocked);
  });

  it("still fails the run on any other error", async () => {
    await expect(
      perAccount(accounts, async (a) => {
        if ((a as { runAccountId: string }).runAccountId === "c") throw new Error("store unavailable");
        return 1;
      }),
    ).rejects.toThrow("store unavailable");
  });
});

describe("a model worth forgetting for good", () => {
  const unavailable = (message: string) => new AIError(message, "PROVIDER_UNAVAILABLE", true, "OPENAI", 400);

  it("is the one that says it is gone", () => {
    for (const message of [
      "The model `gpt-5-codex` has been deprecated",
      "This model is not supported in the v1/chat/completions endpoint",
      "The model does not exist",
    ]) {
      expect(isRetiredModel(unavailable(message))).toBe(true);
    }
  });

  it("is not a provider having a bad day", () => {
    for (const message of [
      "You have no credits remaining",
      "This model is currently experiencing high demand",
      "You exceeded your current quota",
      "Anthropic returned empty content",
    ]) {
      expect(isRetiredModel(unavailable(message))).toBe(false);
    }
    expect(isRetiredModel(new Error("has been deprecated"))).toBe(false);
  });
});
