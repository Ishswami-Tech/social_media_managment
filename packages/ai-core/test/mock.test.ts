import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AIExecutor,
  ContentOperations,
  MockProvider,
  ModelRouter,
  placeholderPng,
  runAgent,
  type AIProvider,
  type ModelInfo,
} from "../src/index";

const catalogue: ModelInfo[] = [
  { provider: "OPENAI", model: "gpt-5-mini", capabilities: ["text", "json"], inputCostPerM: 0.25, outputCostPerM: 2 },
  { provider: "OPENAI", model: "gpt-image-1", capabilities: ["image"], imageCost: 0.04 },
];
const providers = new Map<"OPENAI", AIProvider>([["OPENAI", new MockProvider("OPENAI")]]);
const executor = new AIExecutor(providers, new ModelRouter(catalogue), async () => ({ apiKey: "mock" }));
const ops = new ContentOperations(executor);
const ctx = { availableProviders: ["OPENAI" as const], allowFallback: true };

describe("MockProvider", () => {
  it("returns valid JSON for every structured operation", async () => {
    const variants = await ops.generateVariants(ctx, {
      idea: "We just launched our single-origin espresso blend. Come and try it this weekend!",
      targets: [
        { platform: "LINKEDIN", maxLength: 3000, supportsHashtags: true },
        { platform: "INSTAGRAM", maxLength: 2200, supportsHashtags: true },
      ],
    });
    expect(variants.variants.map((v) => v.platform)).toEqual(["LINKEDIN", "INSTAGRAM"]);
    expect(variants.variants[0]!.hashtags.length).toBeGreaterThan(0);

    const tags = await ops.hashtags(ctx, { text: "Fresh roast just landed from Ethiopia", platform: "LINKEDIN" });
    expect(tags.every((t) => t.startsWith("#"))).toBe(true);

    const hooks = await ops.hooksAndCtas(ctx, { idea: "Espresso launch", platform: "LINKEDIN" });
    expect(hooks.hooks).toHaveLength(5);

    const calendar = await ops.calendar(ctx, {
      theme: "Coffee month",
      platforms: ["LINKEDIN", "FACEBOOK"],
      startDate: "2026-10-01",
      days: 7,
      postsPerWeek: 3,
    });
    expect(calendar.items).toHaveLength(7);

    const quality = await ops.qualityCheck(ctx, { text: "Short post without tags", platform: "LINKEDIN" });
    expect(quality.score).toBeGreaterThan(0);
    expect(quality.issues.some((i) => i.type === "hashtags")).toBe(true);

    const reply = await ops.suggestReply(ctx, {
      conversation: [{ direction: "INBOUND", text: "Do you deliver on Sundays?" }],
    });
    expect(reply.reply.length).toBeGreaterThan(10);
  });

  it("rewrites, shortens and expands plain text", async () => {
    const text = "We just launched our blend. It is finally here. Come and try it. #coffee";
    const rewritten = await ops.transform(ctx, { text, operation: "REWRITE" });
    expect(rewritten).not.toEqual(text);
    const shorter = await ops.transform(ctx, { text, operation: "SHORTEN" });
    expect(shorter.length).toBeLessThan(text.length);
    const longer = await ops.transform(ctx, { text, operation: "EXPAND" });
    expect(longer.length).toBeGreaterThan(text.length);
  });

  it("answers an agent run with a structured brief without calling tools", async () => {
    const res = await runAgent(executor, ctx, {
      system: "You are a researcher.",
      user: "Research: specialty coffee trends for LINKEDIN",
      tools: [
        {
          definition: { name: "web_search", description: "search", parameters: { type: "object", properties: {} } },
          run: async () => {
            throw new Error("should not be called");
          },
        },
      ],
      maxSteps: 3,
      json: true,
      operation: "REPURPOSE",
    });
    const brief = z
      .object({ title: z.string(), postIdeas: z.array(z.object({ platform: z.string() })) })
      .parse(JSON.parse(res.text));
    expect(brief.postIdeas[0]!.platform).toBe("LINKEDIN");
  });

  it("generates a well-formed PNG placeholder image", async () => {
    const res = await new MockProvider("OPENAI").generateImage(
      { model: "gpt-image-1", prompt: "coffee", size: "1024x1024" },
      { apiKey: "mock" },
    );
    const png = Buffer.from(res.images[0]!.base64!, "base64");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(placeholderPng(8, 4, 1).length).toBeLessThan(200);
  });
});
