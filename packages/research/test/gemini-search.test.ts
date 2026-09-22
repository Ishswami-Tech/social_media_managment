import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiSearchConnector, groundingToResults } from "../src/index";

afterEach(() => vi.unstubAllGlobals());

const grounded = {
  candidates: [
    {
      content: { parts: [{ text: "Cold brew sales grew 20% in 2025." }] },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://example.com/report", title: "Cold brew report" } },
          { web: { uri: "https://example.com/news", title: "Coffee news" } },
          { web: { uri: "https://example.com/report", title: "Cold brew report (dup)" } },
        ],
        groundingSupports: [
          { segment: { text: "Cold brew sales grew 20% in 2025." }, groundingChunkIndices: [0] },
          { segment: { text: "Retailers expanded shelf space." }, groundingChunkIndices: [0, 1] },
        ],
      },
      finishReason: "STOP",
    },
  ],
};

describe("groundingToResults", () => {
  it("maps grounding chunks to results with snippets from the supported segments and drops duplicate URLs", () => {
    const results = groundingToResults(grounded, 6);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Cold brew report",
      url: "https://example.com/report",
      source: "google_search",
    });
    expect(results[0]!.snippet).toContain("grew 20%");
    expect(results[0]!.snippet).toContain("shelf space");
    expect(results[1]!.snippet).toBe("Retailers expanded shelf space.");
  });

  it("returns nothing when the answer carried no grounding", () => {
    expect(groundingToResults({ candidates: [{ content: { parts: [{ text: "no idea" }] } }] }, 6)).toEqual([]);
  });
});

describe("GeminiSearchConnector", () => {
  it("calls generateContent with the google_search tool and the key header", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
      const body = JSON.parse(String(init?.body)) as { tools: unknown; contents: { parts: { text: string }[] }[] };
      expect(body.tools).toEqual([{ google_search: {} }]);
      expect(body.contents[0]!.parts[0]!.text).toContain("from the last 7 days");
      expect(body.contents[0]!.parts[0]!.text).toContain("cold brew trends");
      return new Response(JSON.stringify(grounded), { status: 200 });
    });
    const connector = new GeminiSearchConnector({ apiKey: "k", model: "gemini-x", fetchImpl: fetchImpl as typeof fetch });
    const results = await connector.search("cold brew trends", { freshness: "week", maxResults: 1 });
    expect(connector.id).toBe("GEMINI");
    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe("https://example.com/report");
  });

  it("surfaces HTTP errors without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    const connector = new GeminiSearchConnector({ apiKey: "secret", model: "gemini-x", fetchImpl: fetchImpl as typeof fetch });
    await expect(connector.search("x")).rejects.toThrow(/responded 429: quota exceeded/);
  });
});
