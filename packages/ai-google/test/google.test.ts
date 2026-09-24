import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@platform/ai-core";
import { GoogleProvider, capabilitiesFor, isGeminiImageModel, rankGeminiModel, toContents } from "../src/index";

type Captured = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function mockFetch(response: unknown): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      captured.push({
        url,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
        headers: (init?.headers as Record<string, string>) ?? {},
      });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

const auth = { apiKey: "k" };
const provider = new GoogleProvider();

describe("toContents", () => {
  it("maps system, assistant tool calls and tool results to Gemini parts", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_url", arguments: { url: "u" } }] },
      { role: "tool", toolCallId: "c1", name: "read_url", content: '{"title":"T"}' },
      { role: "tool", toolCallId: "c2", name: "web_search", content: "plain text" },
    ];
    const { system, contents } = toContents(messages);
    expect(system).toBe("sys");
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "go" }] },
      { role: "model", parts: [{ functionCall: { name: "read_url", args: { url: "u" } } }] },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "read_url", response: { title: "T" } } },
          { functionResponse: { name: "web_search", response: { result: "plain text" } } },
        ],
      },
    ]);
  });
});

describe("GoogleProvider.generateText", () => {
  it("sends x-goog-api-key, JSON mode without tools, and parses function calls", async () => {
    const calls = mockFetch({
      candidates: [
        {
          content: { parts: [{ text: "thinking…", thought: true }, { functionCall: { name: "read_url", args: { url: "u" } } }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
    });
    const res = await provider.generateText(
      {
        model: "gemini-2.5-flash",
        json: true,
        tools: [{ name: "read_url", description: "d", parameters: { type: "object" } }],
        messages: [{ role: "user", content: "x" }],
      },
      auth,
    );
    expect(calls[0]!.url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("k");
    const config = calls[0]!.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBeUndefined();
    expect(res.toolCalls).toEqual([{ id: expect.any(String), name: "read_url", arguments: { url: "u" } }]);
    expect(res.text).toBe("");
    expect(res.usage.outputTokens).toBe(12);
  });

  it("uses JSON mode when no tools are present", async () => {
    const calls = mockFetch({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] });
    await provider.generateText({ model: "m", json: true, messages: [{ role: "user", content: "x" }] }, auth);
    const config = calls[0]!.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.maxOutputTokens).toBe(8192);
  });

  it("names the finish reason when Gemini answers with neither text nor a tool call", async () => {
    mockFetch({ candidates: [{ content: { parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL" }] });
    await expect(provider.generateText({ model: "m", messages: [{ role: "user", content: "x" }] }, auth)).rejects.toThrow(
      /Gemini returned no text \(finishReason: MALFORMED_FUNCTION_CALL\)/,
    );
  });

  it("reports a truncated thinking budget as a retryable error", async () => {
    mockFetch({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] });
    await expect(provider.generateText({ model: "m", messages: [{ role: "user", content: "x" }] }, auth)).rejects.toThrow(
      /maxOutputTokens/,
    );
  });
});

describe("images and model listing", () => {
  it("routes Gemini image models through generateContent and Imagen through predict", async () => {
    expect(isGeminiImageModel("gemini-3.1-flash-image")).toBe(true);
    expect(isGeminiImageModel("imagen-4.0-generate-001")).toBe(false);
    const calls = mockFetch({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }],
    });
    const res = await provider.generateImage({ prompt: "a cafe", model: "gemini-3.1-flash-image" }, auth);
    expect(calls[0]!.url).toContain("gemini-3.1-flash-image:generateContent");
    expect((calls[0]!.body.generationConfig as Record<string, unknown>).responseModalities).toEqual(["IMAGE"]);
    expect(res.images[0]).toEqual({ base64: "AAAA", mimeType: "image/png" });
  });

  it("lists the newest flash model first so routing avoids retired ones", async () => {
    expect(rankGeminiModel("gemini-3.6-flash")).toBeGreaterThan(rankGeminiModel("gemini-2.5-flash"));
    expect(rankGeminiModel("gemini-3.6-flash")).toBeGreaterThan(rankGeminiModel("gemini-3.6-pro"));
    expect(rankGeminiModel("gemini-3.6-flash")).toBeGreaterThan(rankGeminiModel("gemini-3.6-flash-lite"));
    expect(rankGeminiModel("gemini-3.6-flash")).toBeGreaterThan(rankGeminiModel("gemini-3.6-flash-preview"));
    expect(rankGeminiModel("gemini-2.5-flash")).toBeGreaterThan(rankGeminiModel("gemma-4-26b-a4b-it"));
    mockFetch({
      models: [
        { name: "models/gemma-4-26b-a4b-it", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.6-flash-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.6-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
      ],
    });
    const models = await provider.listModels(auth);
    expect(models.map((m) => m.id)).toEqual(["gemini-3.6-flash", "gemini-3.6-pro", "gemini-2.5-flash", "gemma-4-26b-a4b-it"]);
  });

  it("tags capabilities by model id and drops embedding models", async () => {
    expect(capabilitiesFor("gemini-2.5-pro")).toEqual(["text", "vision", "json"]);
    expect(capabilitiesFor("imagen-4.0-generate-001")).toEqual(["image"]);
    expect(capabilitiesFor("gemini-3-pro-image")).toEqual(["image"]);
    mockFetch({
      models: [
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
        { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    const models = await provider.listModels(auth);
    expect(models.map((m) => [m.id, m.capabilities.join(",")])).toEqual([
      ["imagen-4.0-generate-001", "image"],
      ["gemini-2.5-flash", "text,vision,json"],
    ]);
  });
});
