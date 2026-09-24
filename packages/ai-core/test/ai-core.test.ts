import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AIError,
  AIExecutor,
  ContentOperations,
  ModelRouter,
  parseJsonOutput,
  withSkillInstructions,
  type AIProvider,
  type ModelInfo,
  type TextRequest,
} from "../src/index";

const catalogue: ModelInfo[] = [
  {
    provider: "OPENAI",
    model: "gpt-5",
    capabilities: ["text", "json", "vision"],
    inputCostPerM: 1.25,
    outputCostPerM: 10,
  },
  { provider: "OPENAI", model: "gpt-5-mini", capabilities: ["text", "json"], inputCostPerM: 0.25, outputCostPerM: 2 },
  {
    provider: "ANTHROPIC",
    model: "claude-sonnet-5",
    capabilities: ["text", "json", "vision"],
    inputCostPerM: 3,
    outputCostPerM: 15,
  },
  {
    provider: "GOOGLE",
    model: "gemini-2.5-flash",
    capabilities: ["text", "json"],
    inputCostPerM: 0.3,
    outputCostPerM: 2.5,
  },
  { provider: "OPENAI", model: "gpt-image-1", capabilities: ["image"], imageCost: 0.04 },
];

describe("AIError.fromHttp", () => {
  it("treats a retired or closed model as a provider problem so the call fails over", () => {
    const retired = AIError.fromHttp("GOOGLE", 400, {
      error: { message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code." },
    });
    expect(retired.code).toBe("PROVIDER_UNAVAILABLE");
    expect(retired.retryable).toBe(true);
    const bad = AIError.fromHttp("GOOGLE", 400, { error: { message: "Invalid JSON payload" } });
    expect(bad.code).toBe("INVALID_REQUEST");
    expect(bad.retryable).toBe(false);
  });
});

describe("ModelRouter", () => {
  const router = new ModelRouter(catalogue);
  const all = ["OPENAI", "ANTHROPIC", "GOOGLE"] as const;

  it("prefers user, then organization, then platform, then cheapest auto", () => {
    expect(
      router.route({ requiredCapability: "text", availableProviders: [...all], user: { provider: "ANTHROPIC" } }).model,
    ).toBe("claude-sonnet-5");
    expect(
      router.route({ requiredCapability: "text", availableProviders: [...all], organization: { model: "gpt-5" } })
        .reason,
    ).toBe("organization");
    expect(
      router.route({ requiredCapability: "text", availableProviders: [...all], platform: { provider: "GOOGLE" } })
        .provider,
    ).toBe("GOOGLE");
    const auto = router.route({ requiredCapability: "text", availableProviders: [...all] });
    expect(auto.reason).toBe("auto");
    expect(auto.model).toBe("gpt-5-mini");
  });

  it("ignores preferences for providers without keys", () => {
    const d = router.route({
      requiredCapability: "text",
      availableProviders: ["GOOGLE"],
      user: { provider: "OPENAI" },
    });
    expect(d.provider).toBe("GOOGLE");
    expect(d.reason).toBe("auto");
  });

  it("filters by capability and throws when nothing fits", () => {
    expect(router.route({ requiredCapability: "image", availableProviders: [...all] }).model).toBe("gpt-image-1");
    expect(() => router.route({ requiredCapability: "image", availableProviders: ["GOOGLE"] })).toThrow(AIError);
  });

  it("builds cross-provider fallbacks first", () => {
    const d = router.route({
      requiredCapability: "text",
      availableProviders: [...all],
      user: { model: "gpt-5" },
      allowFallback: true,
    });
    expect(d.fallbacks[0]?.provider).not.toBe("OPENAI");
    expect(d.fallbacks.length).toBeGreaterThan(0);
  });

  it("estimates cost", () => {
    expect(router.estimateCost("OPENAI", "gpt-5", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(2.25);
    expect(router.estimateCost("OPENAI", "gpt-image-1", { images: 2 })).toBeCloseTo(0.08);
  });
});

describe("AIExecutor", () => {
  const router = new ModelRouter(catalogue);
  const ok = (provider: "OPENAI" | "ANTHROPIC" | "GOOGLE"): AIProvider => ({
    name: provider,
    generateText: vi.fn(async (req) => ({
      text: `${provider}:${req.model}`,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: req.model,
      provider,
      latencyMs: 1,
    })),
  });

  it("fails over to another provider on retryable errors and records usage", async () => {
    const failing: AIProvider = {
      name: "OPENAI",
      generateText: vi.fn(async () => {
        throw new AIError("down", "PROVIDER_UNAVAILABLE", true, "OPENAI", 503);
      }),
    };
    const usage: unknown[] = [];
    const exec = new AIExecutor(
      new Map([
        ["OPENAI", failing],
        ["ANTHROPIC", ok("ANTHROPIC")],
      ]),
      router,
      () => ({ apiKey: "k" }),
      {
        onUsage: (e) => {
          usage.push(e);
        },
      },
    );
    const res = await exec.text(
      { availableProviders: ["OPENAI", "ANTHROPIC"], user: { provider: "OPENAI" }, allowFallback: true },
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(res.provider).toBe("ANTHROPIC");
    expect(usage).toHaveLength(2);
    expect((usage[0] as { success: boolean }).success).toBe(false);
  });

  it("does not fail over on non-retryable errors", async () => {
    const auth: AIProvider = {
      name: "OPENAI",
      generateText: vi.fn(async () => {
        throw new AIError("bad key", "AUTH", false, "OPENAI", 401);
      }),
    };
    const exec = new AIExecutor(
      new Map([
        ["OPENAI", auth],
        ["ANTHROPIC", ok("ANTHROPIC")],
      ]),
      router,
      () => ({ apiKey: "k" }),
    );
    await expect(
      exec.text(
        { availableProviders: ["OPENAI", "ANTHROPIC"], user: { provider: "OPENAI" }, allowFallback: true },
        { messages: [] },
      ),
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("skill instructions", () => {
  it("are appended to the system prompt only when present", () => {
    expect(withSkillInstructions("base")).toBe("base");
    expect(withSkillInstructions("base", "  ")).toBe("base");
    expect(withSkillInstructions("base", "Open with a number.")).toContain("SKILL INSTRUCTIONS");
    expect(withSkillInstructions("base", "Open with a number.")).toContain("Open with a number.");
  });

  it("reach the model through every content operation", async () => {
    const seen: TextRequest[] = [];
    const provider: AIProvider = {
      name: "OPENAI",
      generateText: vi.fn(async (req: TextRequest) => {
        seen.push(req);
        return {
          text: '{"variants":[{"platform":"LINKEDIN","text":"t"}],"hashtags":["#a"],"hooks":["h"],"ctas":["c"],"items":[]}',
          usage: { inputTokens: 1, outputTokens: 1 },
          model: req.model,
          provider: "OPENAI" as const,
          latencyMs: 1,
        };
      }),
    };
    const executor = new AIExecutor(new Map([["OPENAI", provider]]), new ModelRouter(catalogue), () => ({ apiKey: "k" }));
    const ops = new ContentOperations(executor);
    const ctx = { availableProviders: ["OPENAI" as const], allowFallback: false };
    const instructions = "Never open with a question.";
    await ops.generateVariants(ctx, { idea: "launch", targets: [{ platform: "LINKEDIN", maxLength: 3000, supportsHashtags: true }], instructions });
    await ops.transform(ctx, { text: "hello", operation: "REWRITE", instructions });
    await ops.hashtags(ctx, { text: "hello", platform: "LINKEDIN", instructions });
    await ops.hooksAndCtas(ctx, { idea: "launch", platform: "LINKEDIN", instructions });
    await ops.calendar(ctx, { theme: "t", platforms: ["LINKEDIN"], startDate: "2026-10-01", days: 7, postsPerWeek: 2, instructions });
    expect(seen).toHaveLength(5);
    for (const req of seen) {
      const system = req.messages.find((m) => m.role === "system");
      expect(String(system?.content)).toContain("Never open with a question.");
    }
  });
});

describe("parseJsonOutput", () => {
  const schema = z.object({ a: z.number() });
  it("tolerates code fences and prose", () => {
    expect(parseJsonOutput(schema, 'Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("rejects invalid JSON and schema mismatches", () => {
    expect(() => parseJsonOutput(schema, "nope")).toThrow(AIError);
    expect(() => parseJsonOutput(schema, '{"a":"x"}')).toThrow(/validation/);
  });
});
