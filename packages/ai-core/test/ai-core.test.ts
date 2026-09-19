import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIError, AIExecutor, ModelRouter, parseJsonOutput, type AIProvider, type ModelInfo } from "../src/index";

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
