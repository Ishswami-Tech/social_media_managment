import { afterEach, describe, expect, it, vi } from "vitest";
import { HuggingFaceProvider, PollinationsProvider } from "../src/index";

type Call = { url: string; init?: RequestInit };

function imageResponse(): Response {
  return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });
}

function capture(response: () => Response): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

afterEach(() => vi.restoreAllMocks());

describe("HuggingFaceProvider", () => {
  it("posts the prompt with the size to the model endpoint and returns base64 bytes", async () => {
    const { calls, fetchImpl } = capture(imageResponse);
    const provider = new HuggingFaceProvider({ fetchImpl });
    const res = await provider.generateImage({ model: "black-forest-labs/FLUX.1-schnell", prompt: "a cafe at dawn", size: "1536x1024" }, { apiKey: "hf_x" });
    expect(calls[0]!.url).toBe("https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell");
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer hf_x");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ inputs: "a cafe at dawn", parameters: { width: 1536, height: 1024 } });
    expect(res.images[0]).toEqual({ base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"), mimeType: "image/png" });
    expect(res.provider).toBe("HUGGINGFACE");
  });

  it("maps a quota response to a retryable error and refuses text", async () => {
    const { fetchImpl } = capture(() => new Response("rate limited", { status: 429 }));
    const provider = new HuggingFaceProvider({ fetchImpl });
    await expect(provider.generateImage({ model: "m", prompt: "p" }, { apiKey: "k" })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    await expect(provider.generateText({ model: "m", messages: [] }, { apiKey: "k" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await provider.listModels({ apiKey: "k" })).every((m) => m.capabilities.includes("image"))).toBe(true);
  });
});

describe("PollinationsProvider", () => {
  it("builds the prompt URL with size, model, a seed and nologo, without a key when none is set", async () => {
    const { calls, fetchImpl } = capture(imageResponse);
    const provider = new PollinationsProvider({ fetchImpl, random: () => 0.5 });
    const res = await provider.generateImage({ model: "flux", prompt: "queue at a cafe", size: "1024x1024" }, { apiKey: "" });
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://image.pollinations.ai/prompt/queue%20at%20a%20cafe");
    expect(url.searchParams.get("width")).toBe("1024");
    expect(url.searchParams.get("model")).toBe("flux");
    expect(url.searchParams.get("seed")).toBe("500000000");
    expect(url.searchParams.get("nologo")).toBe("true");
    expect(calls[0]!.init!.headers).toEqual({});
    expect(res.images).toHaveLength(1);
  });

  it("sends a token when one is set and rejects non-image answers", async () => {
    const { calls, fetchImpl } = capture(() => new Response("<html>busy</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const provider = new PollinationsProvider({ fetchImpl });
    await expect(provider.generateImage({ model: "flux", prompt: "p" }, { apiKey: "tok" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
});
