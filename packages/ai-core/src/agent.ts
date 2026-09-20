import type { AICapability } from "@platform/types";
import { AIError } from "./errors";
import type { AIExecutor } from "./router";
import type { ChatMessage, RoutingContext, ToolCall, ToolDefinition, Usage } from "./types";

/** A callable plugin: definition + implementation. */
export interface Tool<TArgs = Record<string, unknown>> {
  definition: ToolDefinition;
  run: (args: TArgs) => Promise<unknown>;
}

export interface AgentTrace {
  step: number;
  call: ToolCall;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface AgentResult {
  text: string;
  trace: AgentTrace[];
  usage: Usage;
  steps: number;
  provider: string;
  model: string;
}

export interface AgentOptions {
  system: string;
  user: string;
  tools: Tool[];
  maxSteps?: number;
  temperature?: number;
  json?: boolean;
  operation?: "GENERATE" | "REPURPOSE" | "CALENDAR" | "QUALITY_CHECK";
  /** Cap on serialized tool output passed back to the model */
  maxToolResultChars?: number;
}

type Ctx = Omit<RoutingContext, "requiredCapability"> & { requiredCapability?: AICapability };

/**
 * Minimal tool-use agent loop (spec §11 "Provider Router" + plugins). The model
 * is asked to answer; whenever it requests tool calls we execute them, append
 * the results and continue, up to maxSteps. Works with any provider that
 * implements tool calling (OpenAI, Anthropic, Google).
 */
export async function runAgent(executor: AIExecutor, ctx: Ctx, opts: AgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 6;
  const maxChars = opts.maxToolResultChars ?? 12_000;
  const byName = new Map(opts.tools.map((t) => [t.definition.name, t]));
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const trace: AgentTrace[] = [];
  let provider = "";
  let model = "";

  for (let step = 1; step <= maxSteps + 1; step++) {
    const finalTurn = step > maxSteps;
    const res = await executor.text(ctx, {
      messages: finalTurn
        ? [
            ...messages,
            { role: "user", content: "You have used all available tool calls. Answer now with what you have." },
          ]
        : messages,
      tools: finalTurn ? undefined : opts.tools.map((t) => t.definition),
      temperature: opts.temperature ?? 0.4,
      json: opts.json && (finalTurn || true),
      operation: opts.operation ?? "GENERATE",
      maxTokens: 4000,
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    provider = res.provider;
    model = res.model;

    if (!res.toolCalls?.length) {
      return { text: res.text, trace, usage, steps: step, provider, model };
    }
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const tool = byName.get(call.name);
      const started = Date.now();
      let result: unknown;
      let error: string | undefined;
      if (!tool) {
        error = `Unknown tool ${call.name}`;
        result = { error };
      } else {
        try {
          result = await tool.run(call.arguments);
        } catch (e) {
          error = (e as Error).message;
          result = { error };
        }
      }
      trace.push({ step, call, result, durationMs: Date.now() - started, error });
      let serialized = typeof result === "string" ? result : JSON.stringify(result);
      if (serialized.length > maxChars) serialized = serialized.slice(0, maxChars) + "…[truncated]";
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: serialized });
    }
  }
  throw new AIError("Agent did not produce a final answer", "PROVIDER_UNAVAILABLE", true);
}
