import { afterEach, describe, expect, it, vi } from "vitest";
import { AIError } from "../src/errors";
import { postSse } from "../src/http";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("postSse", () => {
  it("delivers each data payload, even when one arrives split across reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(streamOf(['event: a\ndata: {"n":1}\n\nevent: b\nda', 'ta: {"n":2}\r\n\r\ndata: [DONE]\n\n']), { status: 200 }),
      ),
    );
    const seen: unknown[] = [];
    await postSse("TEST", "https://x", {}, {}, (d) => seen.push(d));
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("maps an HTTP failure to the provider error before reading any events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })));
    await expect(postSse("TEST", "https://x", {}, {}, () => {})).rejects.toBeInstanceOf(AIError);
  });

  it("lets a handler abort the stream with its own error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(['data: {"type":"error"}\n\n']), { status: 200 })));
    const boom = new AIError("stream said no", "PROVIDER_UNAVAILABLE", true, "TEST");
    await expect(
      postSse("TEST", "https://x", {}, {}, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
