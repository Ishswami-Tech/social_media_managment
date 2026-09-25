import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@platform/ai-core";
import { AnthropicProvider } from "../src/index";

type Captured = { url: string; body: Record<string, unknown> };

function mockFetch(response: unknown): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

const auth = { apiKey: "k", baseUrl: "https://gateway.example/api" };

describe("AnthropicProvider", () => {
  it("adds the /v1 prefix to a bare gateway URL", async () => {
    const calls = mockFetch({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1, output_tokens: 1 } });
    const p = new AnthropicProvider();
    await p.generateText({ model: "m", messages: [{ role: "user", content: "x" }] }, auth);
    expect(calls[0]!.url).toBe("https://gateway.example/api/v1/messages");
  });

  it("returns tool_use blocks as toolCalls and keeps text empty", async () => {
    mockFetch({
      content: [{ type: "tool_use", id: "t1", name: "read_url", input: { url: "https://a.b" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const p = new AnthropicProvider();
    const res = await p.generateText(
      {
        model: "m",
        json: true,
        tools: [{ name: "read_url", description: "d", parameters: { type: "object" } }],
        messages: [{ role: "user", content: "x" }],
      },
      auth,
    );
    expect(res.toolCalls).toEqual([{ id: "t1", name: "read_url", arguments: { url: "https://a.b" } }]);
    expect(res.text).toBe("");
  });

  it("sends tool calls and tool results back in Anthropic's block format", async () => {
    const calls = mockFetch({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } });
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "read_url", arguments: { url: "u" } }] },
      { role: "tool", toolCallId: "t1", name: "read_url", content: "page text" },
      { role: "tool", toolCallId: "t2", name: "read_url", content: "more" },
    ];
    const p = new AnthropicProvider();
    await p.generateText({ model: "m", messages }, auth);
    const body = calls[0]!.body;
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_url", input: { url: "u" } }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "page text" },
          { type: "tool_result", tool_use_id: "t2", content: "more" },
        ],
      },
    ]);
  });

  it("re-attaches the JSON prefill only when the model did not echo it", async () => {
    const p = new AnthropicProvider();
    mockFetch({ content: [{ type: "text", text: '"a":1}' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const continued = await p.generateText({ model: "m", json: true, messages: [{ role: "user", content: "x" }] }, auth);
    expect(continued.text).toBe('{"a":1}');

    mockFetch({ content: [{ type: "text", text: '{"a":1}' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const echoed = await p.generateText({ model: "m", json: true, messages: [{ role: "user", content: "x" }] }, auth);
    expect(echoed.text).toBe('{"a":1}');
  });

  it("treats a gateway's usage-limit notice as a rate limit, not an answer", async () => {
    const p = new AnthropicProvider();
    mockFetch({
      id: "msg_limit_1",
      content: [{ type: "text", text: "Usage limit reached. You've reached 100% of your 5-hour quota. Please wait and try again later." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    await expect(p.generateText({ model: "m", messages: [{ role: "user", content: "x" }] }, auth)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      status: 429,
      retryable: true,
    });
  });

  it("lists models from gateways that omit type or display_name", async () => {
    mockFetch({ data: [{ id: "claude-x", display_name: "Claude X" }, { id: "claude-y" }, { id: "emb", type: "embedding" }] });
    const p = new AnthropicProvider();
    const models = await p.listModels(auth);
    expect(models.map((m) => [m.id, m.displayName])).toEqual([
      ["claude-x", "Claude X"],
      ["claude-y", "claude-y"],
    ]);
  });
});
