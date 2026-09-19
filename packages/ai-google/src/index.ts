import {
  AIError,
  getJson,
  postJson,
  type AIProvider,
  type ChatMessage,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ImageRequest,
  type ImageResponse,
  type ProviderAuth,
  type TextRequest,
  type TextResponse,
} from "@platform/ai-core";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

function toContents(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts:
        typeof m.content === "string"
          ? [{ text: m.content }]
          : m.content.map((p) =>
              p.type === "text"
                ? { text: p.text }
                : p.base64
                  ? { inlineData: { mimeType: p.mimeType ?? "image/png", data: p.base64 } }
                  : { fileData: { mimeType: p.mimeType ?? "image/png", fileUri: p.url } },
            ),
    }));
  return { system, contents };
}

export class GoogleProvider implements AIProvider {
  readonly name = "GOOGLE" as const;

  async generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const { system, contents } = toContents(req.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 2048,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.json
          ? { responseMimeType: "application/json", ...(req.jsonSchema ? { responseSchema: req.jsonSchema } : {}) }
          : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const data = await postJson<{
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      promptFeedback?: { blockReason?: string };
    }>(
      "GOOGLE",
      `${auth.baseUrl ?? DEFAULT_BASE}/models/${req.model}:generateContent`,
      body,
      { "x-goog-api-key": auth.apiKey },
      { signal: req.abortSignal },
    );
    if (data.promptFeedback?.blockReason)
      throw new AIError(
        `Gemini blocked the prompt: ${data.promptFeedback.blockReason}`,
        "CONTENT_FILTERED",
        false,
        "GOOGLE",
      );
    const cand = data.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new AIError("Gemini returned no text", "PROVIDER_UNAVAILABLE", true, "GOOGLE", undefined, data);
    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model: req.model,
      provider: "GOOGLE",
      finishReason: cand?.finishReason,
      latencyMs: Date.now() - started,
    };
  }

  /** Imagen via the Gemini API `predict` endpoint. */
  async generateImage(req: ImageRequest, auth: ProviderAuth): Promise<ImageResponse> {
    const started = Date.now();
    const aspect =
      req.size === "1024x1536" || req.size === "1024x1792"
        ? "3:4"
        : req.size === "1536x1024" || req.size === "1792x1024"
          ? "4:3"
          : "1:1";
    const data = await postJson<{ predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] }>(
      "GOOGLE",
      `${auth.baseUrl ?? DEFAULT_BASE}/models/${req.model}:predict`,
      { instances: [{ prompt: req.prompt }], parameters: { sampleCount: req.n ?? 1, aspectRatio: aspect } },
      { "x-goog-api-key": auth.apiKey },
      { signal: req.abortSignal, timeoutMs: 180_000 },
    );
    const images = (data.predictions ?? []).map((p) => ({
      base64: p.bytesBase64Encoded,
      mimeType: p.mimeType ?? "image/png",
    }));
    if (images.length === 0)
      throw new AIError("Imagen returned no images", "PROVIDER_UNAVAILABLE", true, "GOOGLE", undefined, data);
    return { images, model: req.model, provider: "GOOGLE", latencyMs: Date.now() - started };
  }

  async embed(req: EmbeddingRequest, auth: ProviderAuth): Promise<EmbeddingResponse> {
    const data = await postJson<{ embeddings: { values: number[] }[] }>(
      "GOOGLE",
      `${auth.baseUrl ?? DEFAULT_BASE}/models/${req.model}:batchEmbedContents`,
      { requests: req.input.map((text) => ({ model: `models/${req.model}`, content: { parts: [{ text }] } })) },
      { "x-goog-api-key": auth.apiKey },
    );
    return {
      vectors: data.embeddings.map((e) => e.values),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: req.model,
      provider: "GOOGLE",
    };
  }

  async healthCheck(auth: ProviderAuth) {
    try {
      await getJson("GOOGLE", `${auth.baseUrl ?? DEFAULT_BASE}/models?pageSize=1`, { "x-goog-api-key": auth.apiKey });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}
