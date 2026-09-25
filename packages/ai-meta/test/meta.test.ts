import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@platform/ai-core";
import { KNOWN_META_MODELS, MetaProvider, readOutput, toResponsesInput } from "../src/index";

type Captured = { url: string; body: Record<string, unknown> };

function mockFetch(response: unknown, status = 200): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

const auth = { apiKey: "k" };

describe("MetaProvider", () => {
  it("turns chat turns into Responses input with the system prompt as instructions", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_url", arguments: { url: "https://a" } }] },
      { role: "tool", content: "page text", toolCallId: "c1", name: "read_url" },
    ];
    expect(toResponsesInput(messages)).toEqual({
      instructions: "Be brief.",
      input: [
        { role: "user", content: [{ type: "input_text", text: "Hello" }] },
        { type: "function_call", call_id: "c1", name: "read_url", arguments: '{"url":"https://a"}' },
        { type: "function_call_output", call_id: "c1", output: "page text" },
      ],
    });
  });

  it("posts to /responses and reads text, usage and tool calls back", async () => {
    const p = new MetaProvider();
    const captured = mockFetch({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Haiku here" }] },
        { type: "function_call", call_id: "c9", name: "read_url", arguments: '{"url":"https://b"}' },
      ],
      status: "completed",
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    const res = await p.generateText(
      { model: "muse-spark-1.3-contributor", messages: [{ role: "user", content: "x" }], tools: [{ name: "read_url", description: "d", parameters: {} }] },
      auth,
    );
    expect(captured[0]?.url).toBe("https://api.meta.ai/v1/responses");
    expect(captured[0]?.body.model).toBe("muse-spark-1.3-contributor");
    expect(captured[0]?.body.tools).toEqual([{ type: "function", name: "read_url", description: "d", parameters: {} }]);
    expect(res.text).toBe("Haiku here");
    expect(res.toolCalls).toEqual([{ id: "c9", name: "read_url", arguments: { url: "https://b" } }]);
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect(res.provider).toBe("META");
  });

  it("prefers output_text when the reply carries it", () => {
    expect(readOutput({ output_text: "plain" }).text).toBe("plain");
  });

  it("offers the known model when the endpoint has no model listing", async () => {
    const p = new MetaProvider();
    mockFetch({ error: { message: "not found" } }, 404);
    const models = await p.listModels(auth);
    expect(models.map((m) => m.id)).toEqual(KNOWN_META_MODELS.map((m) => m.id));
  });

  it("treats a rejected key as an error, not as an empty listing", async () => {
    const p = new MetaProvider();
    mockFetch({ error: { message: "bad key" } }, 401);
    await expect(p.listModels(auth)).rejects.toMatchObject({ status: 401 });
  });
});
