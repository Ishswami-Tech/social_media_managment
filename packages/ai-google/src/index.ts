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
  type ToolCall,
} from "@platform/ai-core";

/**
 * Gemini API (https://ai.google.dev/gemini-api/docs) over REST. Uses the
 * `generateContent` family, which Google keeps fully supported alongside the
 * newer Interactions API, with `x-goog-api-key` authentication.
 */
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Reasoning models spend thinking tokens from the same output budget before answering. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

type Part = Record<string, unknown>;
interface Content {
  role: "user" | "model";
  parts: Part[];
}

function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function contentParts(content: ChatMessage["content"]): Part[] {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  return content.map((p) =>
    p.type === "text"
      ? { text: p.text }
      : p.base64
        ? { inlineData: { mimeType: p.mimeType ?? "image/png", data: p.base64 } }
        : { fileData: { mimeType: p.mimeType ?? "image/png", fileUri: p.url } },
  );
}

/** Parses a tool result back into JSON when possible; Gemini wants an object in `response`. */
function toolResponse(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { result: parsed };
  } catch {
    return { result: content };
  }
}

/**
 * Converts the provider-neutral transcript into Gemini `contents`: system text
 * becomes `systemInstruction`, assistant tool calls become `functionCall` parts
 * and tool results become `functionResponse` parts in a user turn (consecutive
 * results share one turn).
 */
export function toContents(messages: ChatMessage[]): { system: string; contents: Content[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => textOf(m.content))
    .join("\n\n");
  const contents = messages.reduce<Content[]>((acc, m) => {
    if (m.role === "system") return acc;
    if (m.role === "tool") {
      const part: Part = { functionResponse: { name: m.name ?? "tool", response: toolResponse(textOf(m.content)) } };
      const last = acc[acc.length - 1];
      if (last && last.role === "user" && last.parts.some((p) => "functionResponse" in p)) {
        return [...acc.slice(0, -1), { ...last, parts: [...last.parts, part] }];
      }
      return [...acc, { role: "user", parts: [part] }];
    }
    const calls: Part[] =
      m.role === "assistant" ? (m.toolCalls ?? []).map((c) => ({ functionCall: { name: c.name, args: c.arguments } })) : [];
    const parts = [...contentParts(m.content), ...calls];
    if (parts.length === 0) return acc;
    return [...acc, { role: m.role === "assistant" ? "model" : "user", parts }];
  }, []);
  return { system, contents };
}

interface GenerateResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        thought?: boolean;
        functionCall?: { name: string; args?: Record<string, unknown> };
        inlineData?: { mimeType?: string; data?: string };
      }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

/** Gemini-native image models (e.g. gemini-3.1-flash-image) generate through generateContent; Imagen uses predict. */
export function isGeminiImageModel(model: string): boolean {
  return /gemini.*image/i.test(model);
}

export function capabilitiesFor(modelId: string): string[] {
  if (/imagen|gemini.*image/i.test(modelId)) return ["image"];
  if (/embedding/i.test(modelId)) return ["embedding"];
  return ["text", "vision", "json"];
}

export class GoogleProvider implements AIProvider {
  readonly name = "GOOGLE" as const;

  private headers(auth: ProviderAuth): Record<string, string> {
    return { "x-goog-api-key": auth.apiKey };
  }

  async generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const { system, contents } = toContents(req.messages);
    const usingTools = !!req.tools?.length;
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      // JSON mode and function calling are mutually exclusive on the Gemini API.
      ...(req.json && !usingTools
        ? { responseMimeType: "application/json", ...(req.jsonSchema ? { responseSchema: req.jsonSchema } : {}) }
        : {}),
    };
    const body: Record<string, unknown> = { contents, generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (usingTools) {
      body.tools = [
        {
          functionDeclarations: req.tools!.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }
    const data = await postJson<GenerateResponse>(
      "GOOGLE",
      `${auth.baseUrl ?? DEFAULT_BASE}/models/${req.model}:generateContent`,
      body,
      this.headers(auth),
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
    const parts = cand?.content?.parts ?? [];
    // Thought summaries (thought: true) are not part of the answer.
    const text = parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: `call_${started}_${i}`,
        name: p.functionCall!.name,
        arguments: p.functionCall!.args ?? {},
      }));
    if (!text && toolCalls.length === 0) {
      const truncated = cand?.finishReason === "MAX_TOKENS";
      const reason = cand?.finishReason;
      throw new AIError(
        truncated
          ? "Gemini hit maxOutputTokens before producing any text (thinking consumed the budget); raise maxTokens"
          : `Gemini returned no text${reason ? ` (finishReason: ${reason})` : ""}`,
        "PROVIDER_UNAVAILABLE",
        true,
        "GOOGLE",
        undefined,
        data,
      );
    }
    return {
      text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
      },
      model: req.model,
      provider: "GOOGLE",
      finishReason: cand?.finishReason,
      latencyMs: Date.now() - started,
    };
  }

  /** Imagen via `predict`, or a Gemini image model via `generateContent` with image response modalities. */
  async generateImage(req: ImageRequest, auth: ProviderAuth): Promise<ImageResponse> {
    const started = Date.now();
    const aspect =
      req.size === "1024x1536" || req.size === "1024x1792"
        ? "3:4"
        : req.size === "1536x1024" || req.size === "1792x1024"
          ? "4:3"
          : "1:1";
    if (isGeminiImageModel(req.model)) {
      const data = await postJson<GenerateResponse>(
        "GOOGLE",
        `${auth.baseUrl ?? DEFAULT_BASE}/models/${req.model}:generateContent`,
        {
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
        },
        this.headers(auth),
        { signal: req.abortSignal, timeoutMs: 180_000 },
      );
      const images = (data.candidates ?? [])
        .flatMap((c) => c.content?.parts ?? [])
        .filter((p) => p.inlineData?.data)
        .map((p) => ({ base64: p.inlineData!.data, mimeType: p.inlineData!.mimeType ?? "image/png" }));
      if (images.length === 0)
        throw new AIError("Gemini returned no images", "PROVIDER_UNAVAILABLE", true, "GOOGLE", undefined, data);
      return { images, model: req.model, provider: "GOOGLE", latencyMs: Date.now() - started };
    }
    const data = await postJson<{ predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] }>(
      "GOOGLE",
      `${auth.baseUrl ?? DEFAULT_BASE}/models/${req.model}:predict`,
      { instances: [{ prompt: req.prompt }], parameters: { sampleCount: req.n ?? 1, aspectRatio: aspect } },
      this.headers(auth),
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
      this.headers(auth),
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
      await getJson("GOOGLE", `${auth.baseUrl ?? DEFAULT_BASE}/models?pageSize=1`, this.headers(auth));
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /**
   * Lists generateContent/predict-capable models, newest generation first and
   * "flash" ahead of "pro" within a generation, so automatic routing lands on
   * the current cheap model instead of one Google has retired for new accounts.
   */
  async listModels(auth: ProviderAuth) {
    const base = auth.baseUrl ?? DEFAULT_BASE;
    const { models } = await getJson<{
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    }>("GOOGLE", `${base}/models?pageSize=200`, this.headers(auth));
    return (models ?? [])
      .filter((m) => {
        const methods = m.supportedGenerationMethods ?? [];
        return methods.includes("generateContent") || methods.includes("predict");
      })
      .map((m) => {
        const id = m.name.replace(/^models\//, "");
        return { id, displayName: m.displayName ?? id, capabilities: capabilitiesFor(id) };
      })
      .filter((m) => !m.capabilities.includes("embedding") && !NON_TEXT_RE.test(m.id))
      .sort((a, b) => rankGeminiModel(b.id) - rankGeminiModel(a.id));
  }
}

/**
 * Higher ranks first: generation number dominates, then flash over pro over
 * everything else, stable releases over previews, "lite" last within a tier.
 */
export function rankGeminiModel(id: string): number {
  const lower = id.toLowerCase();
  // Only the Gemini and Imagen families carry a generation that should win; Gemma, LearnLM and
  // other experiments sort after every Gemini so automatic routing never lands on them first.
  const family = /^(gemini|imagen)-/.exec(lower)?.[1];
  const version = family ? /(\d+(?:\.\d+)?)/.exec(lower.slice(family.length + 1)) : null;
  const generation = version ? Number.parseFloat(version[1]!) : 0;
  let tier = 0;
  if (lower.includes("flash")) tier = 30;
  else if (lower.includes("pro")) tier = 20;
  else tier = 10;
  if (lower.includes("lite")) tier -= 5;
  if (lower.includes("preview") || lower.includes("exp")) tier -= 2;
  return (family ? generation * 100 : 0) + tier;
}

/** Models that speak or listen rather than write: never text candidates. */
const NON_TEXT_RE = /tts|audio|live|veo|robotics|aqa|computer-use/i;
