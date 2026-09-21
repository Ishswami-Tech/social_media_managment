import { describe, expect, it, vi } from "vitest";
import { AIExecutor, ModelRouter, runAgent, type AIProvider, type ModelInfo, type TextRequest } from "../src/index";

const catalogue: ModelInfo[] = [
  { provider: "OPENAI", model: "gpt-5", capabilities: ["text", "json"], inputCostPerM: 1, outputCostPerM: 1 },
];

describe("runAgent", () => {
  it("executes tool calls the model requests, feeds results back, and returns the final answer", async () => {
    const seen: TextRequest[] = [];
    const provider: AIProvider = {
      name: "OPENAI",
      generateText: vi.fn(async (req: TextRequest) => {
        seen.push(req);
        const toolTurns = req.messages.filter((m) => m.role === "tool");
        if (toolTurns.length === 0) {
          return {
            text: "",
            toolCalls: [{ id: "c1", name: "web_search", arguments: { query: "espresso trends" } }],
            usage: { inputTokens: 10, outputTokens: 5 },
            model: req.model,
            provider: "OPENAI" as const,
            latencyMs: 1,
          };
        }
        expect(String(toolTurns[0]!.content)).toContain("Cold brew");
        return {
          text: "Brief: cold brew is trending.",
          usage: { inputTokens: 20, outputTokens: 8 },
          model: req.model,
          provider: "OPENAI" as const,
          latencyMs: 1,
        };
      }),
    };
    const exec = new AIExecutor(new Map([["OPENAI", provider]]), new ModelRouter(catalogue), () => ({ apiKey: "k" }));
    const search = vi.fn(async (_args: Record<string, unknown>) => [
      { title: "Cold brew rises", url: "https://x", snippet: "Cold brew sales up 20%" },
    ]);
    const result = await runAgent(
      exec,
      { availableProviders: ["OPENAI"] },
      {
        system: "You research.",
        user: "What is trending in espresso?",
        tools: [
          {
            definition: {
              name: "web_search",
              description: "Search the web",
              parameters: { type: "object", properties: { query: { type: "string" } } },
            },
            run: search,
          },
        ],
      },
    );
    expect(search).toHaveBeenCalledWith({ query: "espresso trends" });
    expect(result.text).toContain("cold brew");
    expect(result.trace).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 13 });
    expect(seen[0]!.tools?.[0]?.name).toBe("web_search");
  });

  it("reports unknown tools and errors back to the model instead of crashing", async () => {
    let turn = 0;
    const provider: AIProvider = {
      name: "OPENAI",
      generateText: vi.fn(async (req: TextRequest) => {
        turn++;
        if (turn === 1)
          return {
            text: "",
            toolCalls: [
              { id: "a", name: "nope", arguments: {} },
              { id: "b", name: "boom", arguments: {} },
            ],
            usage: { inputTokens: 1, outputTokens: 1 },
            model: req.model,
            provider: "OPENAI" as const,
            latencyMs: 1,
          };
        const tools = req.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
        expect(tools[0]).toContain("Unknown tool");
        expect(tools[1]).toContain("kaboom");
        return {
          text: "done",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: req.model,
          provider: "OPENAI" as const,
          latencyMs: 1,
        };
      }),
    };
    const exec = new AIExecutor(new Map([["OPENAI", provider]]), new ModelRouter(catalogue), () => ({ apiKey: "k" }));
    const r = await runAgent(
      exec,
      { availableProviders: ["OPENAI"] },
      {
        system: "s",
        user: "u",
        tools: [
          {
            definition: { name: "boom", description: "", parameters: {} },
            run: async () => {
              throw new Error("kaboom");
            },
          },
        ],
      },
    );
    expect(r.text).toBe("done");
    expect(r.trace.map((t) => t.error)).toEqual(["Unknown tool nope", "kaboom"]);
  });

  it("forces a final answer after maxSteps", async () => {
    const provider: AIProvider = {
      name: "OPENAI",
      generateText: vi.fn(async (req: TextRequest) => {
        if (req.tools)
          return {
            text: "",
            toolCalls: [{ id: "x", name: "t", arguments: {} }],
            usage: { inputTokens: 1, outputTokens: 1 },
            model: req.model,
            provider: "OPENAI" as const,
            latencyMs: 1,
          };
        return {
          text: "final",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: req.model,
          provider: "OPENAI" as const,
          latencyMs: 1,
        };
      }),
    };
    const exec = new AIExecutor(new Map([["OPENAI", provider]]), new ModelRouter(catalogue), () => ({ apiKey: "k" }));
    const r = await runAgent(
      exec,
      { availableProviders: ["OPENAI"] },
      {
        system: "s",
        user: "u",
        maxSteps: 2,
        tools: [{ definition: { name: "t", description: "", parameters: {} }, run: async () => "ok" }],
      },
    );
    expect(r.text).toBe("final");
    expect(r.steps).toBe(3);
    expect(r.trace).toHaveLength(2);
  });
});
