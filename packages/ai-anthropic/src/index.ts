import {
  AIError,
  getJson,
  postJson,
  type AIProvider,
  type ChatMessage,
  type ProviderAuth,
  type TextRequest,
  type TextResponse,
} from "@platform/ai-core";

const DEFAULT_BASE = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

function split(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) =>
      typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n"),
    )
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) =>
              p.type === "text"
                ? { type: "text", text: p.text }
                : p.url
                  ? { type: "image", source: { type: "url", url: p.url } }
                  : {
                      type: "image",
                      source: { type: "base64", media_type: p.mimeType ?? "image/png", data: p.base64 },
                    },
            ),
    }));
  return { system: system || undefined, messages: rest };
}

export class AnthropicProvider implements AIProvider {
  readonly name = "ANTHROPIC" as const;

  async generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const { system, messages } = split(req.messages);
    const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens ?? 2048, messages };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    const usingTools = !!req.tools?.length;
    if (usingTools)
      body.tools = req.tools!.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const prefill = req.json && !usingTools;
    if (prefill) {
      // Prefill the assistant turn so the model starts directly with the JSON object.
      (body.messages as unknown[]).push({ role: "assistant", content: "{" });
    }
    const data = await postJson<{
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
    }>(
      "ANTHROPIC",
      `${auth.baseUrl ?? DEFAULT_BASE}/messages`,
      body,
      { "x-api-key": auth.apiKey, "anthropic-version": API_VERSION },
      { signal: req.abortSignal },
    );
    let text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (req.json) text = "{" + text;
    if (!text) throw new AIError("Anthropic returned empty content", "PROVIDER_UNAVAILABLE", true, "ANTHROPIC");
    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      model: req.model,
      provider: "ANTHROPIC",
      finishReason: data.stop_reason,
      latencyMs: Date.now() - started,
    };
  }

  async healthCheck(auth: ProviderAuth) {
    try {
      await getJson("ANTHROPIC", `${auth.baseUrl ?? DEFAULT_BASE}/models?limit=1`, {
        "x-api-key": auth.apiKey,
        "anthropic-version": API_VERSION,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}
