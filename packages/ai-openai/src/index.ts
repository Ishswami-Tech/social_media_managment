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

const DEFAULT_BASE = "https://api.openai.com/v1";

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) =>
            p.type === "text"
              ? { type: "text", text: p.text }
              : {
                  type: "image_url",
                  image_url: { url: p.url ?? `data:${p.mimeType ?? "image/png"};base64,${p.base64}` },
                },
          ),
  }));
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return { _raw: text };
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = "OPENAI" as const;

  async generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      max_completion_tokens: req.maxTokens ?? 2048,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.jsonSchema)
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "output", schema: req.jsonSchema, strict: false },
      };
    else if (req.json) body.response_format = { type: "json_object" };
    const data = await postJson<{
      choices: {
        message: {
          content: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    }>(
      "OPENAI",
      `${auth.baseUrl ?? DEFAULT_BASE}/chat/completions`,
      body,
      { authorization: `Bearer ${auth.apiKey}` },
      { signal: req.abortSignal },
    );
    const choice = data.choices[0];
    if (!choice) throw new AIError("OpenAI returned no choices", "PROVIDER_UNAVAILABLE", true, "OPENAI");
    const toolCalls = choice.message.tool_calls?.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: safeJson(c.function.arguments),
    }));
    return {
      text: choice.message.content ?? "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      model: req.model,
      provider: "OPENAI",
      finishReason: choice.finish_reason,
      latencyMs: Date.now() - started,
    };
  }

  async generateImage(req: ImageRequest, auth: ProviderAuth): Promise<ImageResponse> {
    const started = Date.now();
    const data = await postJson<{ data: { b64_json?: string; url?: string; revised_prompt?: string }[] }>(
      "OPENAI",
      `${auth.baseUrl ?? DEFAULT_BASE}/images/generations`,
      {
        model: req.model,
        prompt: req.prompt,
        n: req.n ?? 1,
        size: req.size ?? "1024x1024",
        ...(req.model.startsWith("dall-e") ? { response_format: "b64_json", quality: req.quality } : {}),
      },
      { authorization: `Bearer ${auth.apiKey}` },
      { signal: req.abortSignal, timeoutMs: 180_000 },
    );
    return {
      images: data.data.map((d) => ({
        base64: d.b64_json,
        url: d.url,
        mimeType: "image/png",
        revisedPrompt: d.revised_prompt,
      })),
      model: req.model,
      provider: "OPENAI",
      latencyMs: Date.now() - started,
    };
  }

  async embed(req: EmbeddingRequest, auth: ProviderAuth): Promise<EmbeddingResponse> {
    const data = await postJson<{ data: { embedding: number[] }[]; usage?: { prompt_tokens: number } }>(
      "OPENAI",
      `${auth.baseUrl ?? DEFAULT_BASE}/embeddings`,
      { model: req.model, input: req.input },
      { authorization: `Bearer ${auth.apiKey}` },
    );
    return {
      vectors: data.data.map((d) => d.embedding),
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: 0 },
      model: req.model,
      provider: "OPENAI",
    };
  }

  async healthCheck(auth: ProviderAuth) {
    try {
      await getJson("OPENAI", `${auth.baseUrl ?? DEFAULT_BASE}/models?limit=1`, {
        authorization: `Bearer ${auth.apiKey}`,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listModels(auth: ProviderAuth) {
    const { data } = await getJson<{ data: { id: string; created: number }[] }>(
      "OPENAI",
      `${auth.baseUrl ?? DEFAULT_BASE}/models`,
      { authorization: `Bearer ${auth.apiKey}` },
    );
    return data.map((m) => ({ id: m.id, displayName: m.id, capabilities: ["text"] }));
  }
}
