/**
 * Meta AI (Muse Spark) through the Responses API: `POST {base}/responses`
 * with an `input` list of typed items, `instructions` for the system prompt,
 * `function_call` items for tools and `output_text` deltas when streaming.
 * The endpoint does not list models, so a known model is offered when the
 * listing is refused; an organization connection can name its own.
 */
import {
  AIError,
  type AIProvider,
  type ChatMessage,
  type ProviderAuth,
  type TextRequest,
  type TextResponse,
  type ToolCall,
  getJson,
  postJson,
  postSse,
} from "@platform/ai-core";

const DEFAULT_BASE = "https://api.meta.ai/v1";

/** Models the endpoint is known to serve when it does not answer a listing. */
export const KNOWN_META_MODELS = [{ id: "muse-spark-1.3-contributor", displayName: "Muse Spark 1.3", capabilities: ["text", "vision", "json"] }];

type InputItem =
  | { role: "user" | "assistant"; content: { type: "input_text" | "output_text"; text: string }[] | { type: "input_image"; image_url: string }[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

interface OutputItem {
  type?: string;
  content?: { type?: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ResponsesReply {
  output?: OutputItem[];
  output_text?: string;
  status?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** Chat turns become Responses input items; system turns become the `instructions` string. */
export function toResponsesInput(messages: ChatMessage[]): { instructions?: string; input: InputItem[] } {
  const instructions = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n\n");
  const input: InputItem[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.toolCallId ?? m.name ?? "call", output: textOf(m.content) });
      continue;
    }
    if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) input.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of m.toolCalls ?? []) input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
      continue;
    }
    const parts = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    const images = parts.filter((p) => p.type === "image");
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    if (text) input.push({ role: "user", content: [{ type: "input_text", text }] });
    if (images.length > 0)
      input.push({
        role: "user",
        content: images.map((p) => ({ type: "input_image" as const, image_url: p.url ?? `data:${p.mimeType ?? "image/png"};base64,${p.base64}` })),
      });
  }
  return { ...(instructions ? { instructions } : {}), input };
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    return { _raw: text };
  }
}

/** The text and tool calls of a finished response. */
export function readOutput(reply: ResponsesReply): { text: string; toolCalls: ToolCall[] } {
  const items = reply.output ?? [];
  const text =
    reply.output_text ??
    items
      .filter((i) => i.type === "message")
      .flatMap((i) => i.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");
  const toolCalls = items
    .filter((i) => i.type === "function_call" && i.name)
    .map((i) => ({ id: i.call_id ?? i.name!, name: i.name!, arguments: safeJson(i.arguments ?? "{}") }));
  return { text, toolCalls };
}

export class MetaProvider implements AIProvider {
  readonly name = "META" as const;

  private body(req: TextRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      ...toResponsesInput(req.messages),
      max_output_tokens: req.maxTokens ?? 2048,
      stream: false,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length)
      body.tools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));
    return body;
  }

  private async streamText(req: TextRequest, auth: ProviderAuth, body: Record<string, unknown>, started: number): Promise<TextResponse> {
    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: string | undefined;
    await postSse(
      "META",
      `${auth.baseUrl ?? DEFAULT_BASE}/responses`,
      { ...body, stream: true },
      { authorization: `Bearer ${auth.apiKey}` },
      (data) => {
        const ev = data as { type?: string; delta?: string; response?: ResponsesReply };
        if (ev.type === "response.output_text.delta" && ev.delta) {
          text += ev.delta;
          req.onChunk?.(ev.delta);
        }
        if (ev.type === "response.completed" && ev.response) {
          usage = { inputTokens: ev.response.usage?.input_tokens ?? 0, outputTokens: ev.response.usage?.output_tokens ?? 0 };
          finishReason = ev.response.status;
          if (!text) text = readOutput(ev.response).text;
        }
        if (ev.type === "error" || ev.type === "response.failed") {
          throw new AIError(ev.response?.error?.message ?? "Meta stream error", "PROVIDER_UNAVAILABLE", true, "META");
        }
      },
      { signal: req.abortSignal },
    );
    if (!text) throw new AIError("Meta returned no text", "PROVIDER_UNAVAILABLE", true, "META");
    return { text, usage, model: req.model, provider: "META", finishReason, latencyMs: Date.now() - started };
  }

  async generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const body = this.body(req);
    if (req.onChunk && !req.tools?.length) return this.streamText(req, auth, body, started);
    const reply = await postJson<ResponsesReply>(
      "META",
      `${auth.baseUrl ?? DEFAULT_BASE}/responses`,
      body,
      { authorization: `Bearer ${auth.apiKey}` },
      { signal: req.abortSignal },
    );
    if (reply.error?.message) throw new AIError(reply.error.message, "PROVIDER_UNAVAILABLE", true, "META");
    const { text, toolCalls } = readOutput(reply);
    if (!text && toolCalls.length === 0) throw new AIError("Meta returned no text", "PROVIDER_UNAVAILABLE", true, "META");
    return {
      text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: { inputTokens: reply.usage?.input_tokens ?? 0, outputTokens: reply.usage?.output_tokens ?? 0 },
      model: req.model,
      provider: "META",
      finishReason: reply.status,
      latencyMs: Date.now() - started,
    };
  }

  async healthCheck(auth: ProviderAuth) {
    try {
      await this.listModels(auth);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listModels(auth: ProviderAuth) {
    try {
      const { data } = await getJson<{ data: { id: string }[] }>("META", `${auth.baseUrl ?? DEFAULT_BASE}/models`, {
        authorization: `Bearer ${auth.apiKey}`,
      });
      if (data.length > 0) return data.map((m) => ({ id: m.id, displayName: m.id, capabilities: ["text", "json"] }));
    } catch (e) {
      // No listing: an invalid key is still an error, an absent endpoint is not.
      if (e instanceof AIError && e.status === 401) throw e;
    }
    return KNOWN_META_MODELS.map((m) => ({ ...m, capabilities: [...m.capabilities] }));
  }
}
