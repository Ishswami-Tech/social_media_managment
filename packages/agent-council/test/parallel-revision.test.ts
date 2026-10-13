import { describe, expect, it } from "vitest";
import { reviewStage } from "../src/stages/review";
import { strategyStage } from "../src/stages/strategy";
import { writersStage } from "../src/stages/writers";
import { createTestContext } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

const ALLOWED = ["OPENAI::gpt-test", "ANTHROPIC::claude-test"];

/** The figure that identifies which draft a request is carrying. */
const DRAFT_MARKS = ["4.2 million", "7.9 million"];

/**
 * Revising a draft is a model call. Done one draft after another it cost a
 * real run as much as every other stage put together, purely because of the
 * shape of the loop. These watch that the drafts of an account are worked
 * together.
 */
describe("the drafts of one account", () => {
  /**
   * Counts how many *different drafts* are in flight at once, not how many
   * calls.
   *
   * A plain call count proves nothing here: reviewing a single draft already
   * fans out to three council seats in parallel, so any implementation shows
   * several calls at once. Each draft carries its own writer text, so the
   * text in the request says which draft a call belongs to.
   */
  function watchDraftsInFlight(ctx: { executor: Record<string, unknown> }) {
    const seen = { peak: 0 };
    const live = new Map<string, number>();
    const original = ctx.executor.text as (...args: unknown[]) => Promise<unknown>;
    ctx.executor.text = async (...args: unknown[]) => {
      const body = JSON.stringify(args);
      const draft = DRAFT_MARKS.find((t) => body.includes(t));
      if (draft) {
        live.set(draft, (live.get(draft) ?? 0) + 1);
        seen.peak = Math.max(seen.peak, live.size);
      }
      try {
        await new Promise((r) => setTimeout(r, 15));
        return await original.apply(ctx.executor, args);
      } finally {
        if (draft) {
          const n = (live.get(draft) ?? 1) - 1;
          if (n <= 0) live.delete(draft);
          else live.set(draft, n);
        }
      }
    };
    return seen;
  }

  /** A draft carrying a figure no claim supports, so the checks send it for revision. */
  const failingDraft = (label: string, millions: string) => ({
    label,
    role: "WRITER" as const,
    provider: "OPENAI" as const,
    model: "gpt-test",
    promptKey: "writer",
    promptVersion: 1,
    promptHash: "hash",
    text: `Our pilot reached ${millions} million people last quarter.\n\nThat number hid the real story: setup was still manual.\n\nWhat would you change first?`,
    hashtags: [],
    claimIds: [],
    costCents: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 1,
  });

  /**
   * One account holding two drafts that both need revising.
   *
   * Both details matter. A single account, because the stage already works
   * accounts in parallel and two of those would overlap whatever the inner
   * loop does. Two *failing* drafts, because a clean draft never reaches the
   * editor, and the shipped fixture only ever fails one.
   */
  function withFailingDrafts() {
    const single = baseRun();
    const account = { ...single.accounts[0]!, drafts: [failingDraft("A", "4.2"), failingDraft("B", "7.9")] };
    return createTestContext({ ...single, accounts: [account] }, { allowedModels: ALLOWED });
  }

  /** The ordering check only needs real drafts, so it drives the earlier stages. */
  async function withDrafts() {
    const single = baseRun();
    const run = { ...single, accounts: [single.accounts[0]!] };
    const made = createTestContext(run, { allowedModels: ALLOWED });
    await strategyStage(made.ctx, made.memory.snapshot());
    await writersStage(made.ctx, made.memory.snapshot());
    return made;
  }

  it("are checked and revised at the same time, not one after another", async () => {
    const { ctx, memory } = withFailingDrafts();
    const seen = watchDraftsInFlight(ctx as never);

    await reviewStage(ctx, memory.snapshot());

    // One account, so the only thing that can overlap is its own drafts.
    expect(seen.peak).toBeGreaterThan(1);
  });

  it("still come back in the order they were written", async () => {
    const { ctx, memory } = await withDrafts();
    await reviewStage(ctx, memory.snapshot());

    for (const account of memory.snapshot().accounts) {
      const labels = account.drafts.map((d) => d.label);
      expect(labels).toEqual([...labels].sort());
    }
  });
});
