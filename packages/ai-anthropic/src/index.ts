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

const DEFAULT_BASE = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";
/** Generous default: reasoning models spend thinking tokens from the same budget before answering. */
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * Anthropic-compatible endpoints are versioned under `/v1` (`/v1/messages`,
 * `/v1/models`). Accept a bare host or gateway root as well as a URL that
 * already ends in `/v1`, with or without a trailing slash.
 */
function apiBase(auth: ProviderAuth): string {
  const base = (auth.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

type AnthropicBlock = Record<string, unknown>;
interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

function textOf(content: ChatMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function contentBlocks(content: ChatMessage["content"]): AnthropicBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : p.url
        ? { type: "image", source: { type: "url", url: p.url } }
        : { type: "image", source: { type: "base64", media_type: p.mimeType ?? "image/png", data: p.base64 } },
  );
}

/**
 * Converts the provider-neutral transcript into Anthropic's shape: system text
 * is lifted out, assistant tool calls become `tool_use` blocks and tool results
 * become `tool_result` blocks inside a user turn (consecutive results share one
 * turn, as the API requires strictly alternating roles).
 */
function split(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => textOf(m.content))
    .join("\n\n");
  const rest = messages.reduce<AnthropicMessage[]>((acc, m) => {
    if (m.role === "system") return acc;
    if (m.role === "tool") {
      const block: AnthropicBlock = { type: "tool_result", tool_use_id: m.toolCallId, content: textOf(m.content) };
      const last = acc[acc.length - 1];
      if (last && last.role === "user" && last.content.some((b) => b.type === "tool_result")) {
        return [...acc.slice(0, -1), { ...last, content: [...last.content, block] }];
      }
      return [...acc, { role: "user", content: [block] }];
    }
    const toolUse: AnthropicBlock[] =
      m.role === "assistant"
        ? (m.toolCalls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.arguments }))
        : [];
    const content = [...contentBlocks(m.content), ...toolUse];
    if (content.length === 0) return acc;
    return [...acc, { role: m.role, content }];
  }, []);
  return { system: system || undefined, messages: rest };
}

interface StreamEvent {
  type: string;
  message?: { usage?: { input_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

export class AnthropicProvider implements AIProvider {
  readonly name = "ANTHROPIC" as const;

  /** Same request with `stream: true`; text deltas go to `req.onChunk` as they land. */
  private async streamText(
    req: TextRequest,
    auth: ProviderAuth,
    body: Record<string, unknown>,
    prefill: boolean | undefined,
    started: number,
  ): Promise<TextResponse> {
    let rawText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;
    await postSse(
      "ANTHROPIC",
      `${apiBase(auth)}/messages`,
      { ...body, stream: true },
      { "x-api-key": auth.apiKey, "anthropic-version": API_VERSION },
      (data) => {
        const ev = data as StreamEvent;
        if (ev.type === "message_start") inputTokens = ev.message?.usage?.input_tokens ?? 0;
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          rawText += ev.delta.text;
          req.onChunk?.(ev.delta.text);
        } else if (ev.type === "message_delta") {
          stopReason = ev.delta?.stop_reason ?? stopReason;
          outputTokens = ev.usage?.output_tokens ?? outputTokens;
        } else if (ev.type === "error") {
          throw new AIError(ev.error?.message ?? "Anthropic stream error", "PROVIDER_UNAVAILABLE", true, "ANTHROPIC");
        }
      },
      { signal: req.abortSignal },
    );
    return this.finish(req, rawText, [], prefill, { inputTokens, outputTokens }, stopReason, started);
  }

  /** Shared tail of both paths: prefill repair, the empty-answer check, the response shape. */
  private finish(
    req: TextRequest,
    rawText: string,
    toolCalls: ToolCall[],
    prefill: boolean | undefined,
    usage: { inputTokens: number; outputTokens: number },
    stopReason: string | undefined,
    started: number,
  ): TextResponse {
    // Re-attach the prefilled "{" unless the model (or a gateway that ignores
    // prefills) already answered with a complete object or a code fence.
    const lead = rawText.trimStart();
    const text = !prefill || lead.startsWith("{") || lead.startsWith("`") ? rawText : "{" + rawText;
    if (!rawText && toolCalls.length === 0) {
      const truncated = stopReason === "max_tokens";
      throw new AIError(
        truncated
          ? "Anthropic hit max_tokens before producing any text (reasoning consumed the budget); raise maxTokens"
          : "Anthropic returned empty content",
        "PROVIDER_UNAVAILABLE",
        true,
        "ANTHROPIC",
      );
    }
    return {
      text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage,
      model: req.model,
      provider: "ANTHROPIC",
      finishReason: stopReason,
      latencyMs: Date.now() - started,
    };
  }

  async generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const { system, messages } = split(req.messages);
    const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS, messages };
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
    if (req.onChunk && !usingTools) return this.streamText(req, auth, body, prefill, started);
    const data = await postJson<{
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
    }>(
      "ANTHROPIC",
      `${apiBase(auth)}/messages`,
      body,
      { "x-api-key": auth.apiKey, "anthropic-version": API_VERSION },
      { signal: req.abortSignal },
    );
    const toolCalls: ToolCall[] = data.content
      .filter((c) => c.type === "tool_use" && !!c.id && !!c.name)
      .map((c) => ({ id: c.id!, name: c.name!, arguments: c.input ?? {} }));
    const rawText = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    return this.finish(
      req,
      rawText,
      toolCalls,
      prefill,
      { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      data.stop_reason,
      started,
    );
  }

  async healthCheck(auth: ProviderAuth) {
    try {
      await getJson("ANTHROPIC", `${apiBase(auth)}/models?limit=1`, {
        "x-api-key": auth.apiKey,
        "anthropic-version": API_VERSION,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listModels(auth: ProviderAuth) {
    const { data } = await getJson<{ data?: { id: string; display_name?: string; name?: string; type?: string }[] }>(
      "ANTHROPIC",
      `${apiBase(auth)}/models`,
      { "x-api-key": auth.apiKey, "anthropic-version": API_VERSION },
    );
    // Proxies may omit `type` or use `name` instead of `display_name`; never drop a model for that.
    return (data ?? [])
      .filter((m) => m.id && (m.type === undefined || m.type === "model"))
      .map((m) => ({ id: m.id, displayName: m.display_name ?? m.name ?? m.id, capabilities: ["text", "vision", "json"] }));
  }
}
