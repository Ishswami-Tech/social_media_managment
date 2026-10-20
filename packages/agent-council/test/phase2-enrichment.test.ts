import { describe, expect, it } from "vitest";
import {
  claimsIdsText,
  draftsForPlatformReview,
  PLATFORM_REVIEW_TOP_N,
  rankDraftsForReview,
  runContextPack,
  skillInstructionsFor,
} from "../src/stages/shared";
import type { ClaimRecord, DraftCandidate, PipelineContext, RunSnapshot } from "../src/contracts";
import { createTestContext } from "./helpers/fakes";
import { baseRun } from "./helpers/run";

function draft(label: string, opts: Partial<DraftCandidate> = {}): DraftCandidate {
  return {
    label,
    role: "WRITER",
    provider: "OPENAI",
    model: "gpt-test",
    promptKey: "writer",
    promptVersion: 1,
    promptHash: "x",
    text: opts.text ?? "x".repeat(400),
    hashtags: opts.hashtags ?? [],
    claimIds: opts.claimIds ?? [],
    costCents: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    ...opts,
  };
}

describe("Phase 2 token enrichment", () => {
  it("ranks drafts by claims then length, and caps Standard Lens to top N", () => {
    const drafts = [
      draft("A", { claimIds: ["c1"], text: "a".repeat(100) }),
      draft("B", { claimIds: ["c1", "c2"], text: "b".repeat(500) }),
      draft("C", { claimIds: [], text: "c".repeat(900), hashtags: Array.from({ length: 12 }, (_, i) => `#t${i}`) }),
    ];
    expect(rankDraftsForReview(drafts).map((d) => d.label)).toEqual(["B", "A", "C"]);

    const standard = draftsForPlatformReview(drafts, "JUDGE_ONLY");
    expect(standard.deep).toHaveLength(PLATFORM_REVIEW_TOP_N);
    expect(standard.deep.map((d) => d.label)).toEqual(["B", "A"]);
    expect(standard.passThrough.map((d) => d.label)).toEqual(["C"]);

    const thorough = draftsForPlatformReview(drafts, "HIGH_ASSURANCE");
    expect(thorough.deep).toHaveLength(3);
    expect(thorough.passThrough).toEqual([]);
  });

  it("builds a compact run context pack and id-only claims", () => {
    const run = baseRun() as RunSnapshot;
    run.claims = [
      {
        id: "claim_1",
        statement: "Queues fell 40%",
        status: "SUPPORTED",
        confidence: 0.9,
        sourceUrl: "https://example.com/long",
        evidence: "a long quote that should not appear in the compact form",
      },
    ] as ClaimRecord[];
    run.accounts[0]!.strategy = {
      angle: "Reply speed",
      hookType: "statistic",
      format: "text post",
      cta: "Ask your team",
      keyPoints: ["fast replies"],
      claimIds: ["claim_1"],
      rationale: "works",
    };

    const pack = runContextPack(run, run.accounts[0]);
    expect(pack).toContain("Topic:");
    expect(pack).toContain("Strategy: Reply speed");
    expect(pack).toContain("[claim_1] Queues fell 40%");
    expect(pack).not.toContain("https://example.com/long");
    expect(pack).not.toContain("a long quote");

    expect(claimsIdsText(run.claims)).toBe("- [claim_1] Queues fell 40%");
  });

  it("gives review a tighter skill budget than writer", () => {
    const { ctx } = createTestContext(baseRun());
    const long = "line\n".repeat(8_000);
    const run = {
      ...baseRun(),
      skillIds: ["custom:big"],
    } as RunSnapshot;
    (ctx as PipelineContext).skills = [
      {
        id: "custom:big",
        name: "Hooks",
        description: "many",
        instructions: long,
        platforms: [],
        always: false,
      },
    ];

    const writer = skillInstructionsFor(ctx, run, "LINKEDIN", "writer") ?? "";
    const review = skillInstructionsFor(ctx, run, "LINKEDIN", "review") ?? "";
    expect(writer.length).toBeGreaterThan(review.length);
    expect(review).toContain("[truncated: this playbook is longer than the prompt allows]");
  });
});
