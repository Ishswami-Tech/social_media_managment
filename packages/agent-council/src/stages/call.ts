/**
 * Every model call of the pipeline goes through here so routing, the circuit
 * breaker, the budget and the replay events stay consistent and no stage can
 * spend money without a reservation or without leaving a trace.
 */
import type { AICapability, AIProviderName } from "@platform/types";
import { parseJsonOutput, runAgent, type RoutingContext, type Tool, type Usage } from "@platform/ai-core";
import type { z } from "zod";
import { estimateCallCents, estimateTokens, usageToCents } from "../budget";
import type { PipelineContext } from "../contracts";
import { errorMessage, PipelineBlocked } from "../errors";
import { getPrompt } from "../prompts";

/** Replay events keep a bounded copy of what went into and came out of a call. */
export const MAX_EVENT_CHARS = 2_000;
const DEFAULT_OUTPUT_TOKENS = 900;
const MIN_MAX_TOKENS = 1_024;
/**
 * Reasoning models spend "thinking" tokens out of the same max_tokens budget
 * before writing any text. The expected output size drives the cost estimate;
 * the request budget adds headroom so thinking never starves the answer.
 */
const THINKING_HEADROOM_TOKENS = 12_000;
/** Ceiling for the automatic retry after a reasoning model exhausts its budget. */
const MAX_RETRY_TOKENS = 64_000;

/** True when a provider reported that thinking consumed the whole output budget. */
export function isBudgetExhausted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /max_tokens|maxOutputTokens|consumed the budget/i.test(message);
}

export type RoutingCtx = Omit<RoutingContext, "requiredCapability"> & { requiredCapability?: AICapability };

export interface ProviderPreference {
  provider?: AIProviderName;
  model?: string;
}

export interface ModelDecision {
  /** Routing context pinned to the resolved provider/model (no silent failover). */
  routing: RoutingCtx;
  provider: AIProviderName;
  model: string;
}

export interface ModelCallInput {
  runId: string;
  organizationId: string;
  /** Replay step name, e.g. "writer:acc_1:A". */
  step: string;
  promptKey: string;
  capability: "text" | "json";
  pref?: ProviderPreference;
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
  expectedOutputTokens?: number;
  /** Tool-use loop (research stage only). */
  tools?: readonly Tool[];
  maxSteps?: number;
}

export interface ModelCallResult {
  text: string;
  usage: Usage;
  provider: AIProviderName;
  model: string;
  costCents: number;
  latencyMs: number;
  promptKey: string;
  promptVersion: number;
  promptHash: string;
}

export function truncate(value: string, max: number = MAX_EVENT_CHARS): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

/** Preference order tried when the first choice sits behind an open breaker. */
function candidatePreferences(ctx: PipelineContext, pref?: ProviderPreference): (ProviderPreference | undefined)[] {
  const others = ctx.availableProviders.filter((p) => p !== pref?.provider).map((provider) => ({ provider }));
  return pref ? [pref, ...others] : [undefined, ...others];
}

/**
 * Resolves provider + model up front (so the breaker and the budget know what
 * they are dealing with) and skips providers whose breaker is open.
 */
export async function resolveProvider(
  ctx: PipelineContext,
  capability: "text" | "json",
  pref?: ProviderPreference,
): Promise<ModelDecision> {
  const seen = new Set<string>();
  for (const candidate of candidatePreferences(ctx, pref)) {
    const routing = await ctx.routing(capability, candidate);
    let provider: AIProviderName;
    let model: string;
    try {
      const decision = ctx.router.route({ ...routing, requiredCapability: capability });
      provider = decision.provider;
      model = decision.model;
    } catch {
      continue;
    }
    const key = `${provider}::${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (await ctx.health.isOpen(provider)) continue;
    return {
      provider,
      model,
      routing: { ...routing, requiredCapability: capability, allowFallback: false, user: { provider, model } },
    };
  }
  throw new PipelineBlocked("providers unavailable");
}

interface Attempt {
  text: string;
  usage: Usage;
  latencyMs: number;
}

/**
 * One model call with a given output budget. Reasoning models may spend the
 * whole budget thinking; `execute` retries once with double the budget when a
 * provider reports that.
 */
async function execute(ctx: PipelineContext, input: ModelCallInput, decision: ModelDecision): Promise<Attempt> {
  const expectedOutput = Math.max(MIN_MAX_TOKENS, input.expectedOutputTokens ?? DEFAULT_OUTPUT_TOKENS);
  const maxTokens = expectedOutput + THINKING_HEADROOM_TOKENS;
  try {
    return await executeWithBudget(ctx, input, decision, maxTokens);
  } catch (error) {
    if (!isBudgetExhausted(error) || maxTokens >= MAX_RETRY_TOKENS) throw error;
    return executeWithBudget(ctx, input, decision, Math.min(MAX_RETRY_TOKENS, maxTokens * 2));
  }
}

async function executeWithBudget(
  ctx: PipelineContext,
  input: ModelCallInput,
  decision: ModelDecision,
  maxTokens: number,
): Promise<Attempt> {
  const started = Date.now();
  if (input.tools) {
    const result = await runAgent(ctx.executor, decision.routing, {
      system: input.system,
      user: input.user,
      tools: [...input.tools],
      maxSteps: input.maxSteps,
      temperature: input.temperature,
      json: input.json,
      maxTokens,
    });
    return { text: result.text, usage: result.usage, latencyMs: Date.now() - started };
  }
  const res = await ctx.executor.text(decision.routing, {
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    json: input.json,
    temperature: input.temperature,
    maxTokens,
    operation: "GENERATE",
  });
  return { text: res.text, usage: res.usage, latencyMs: res.latencyMs || Date.now() - started };
}

/**
 * Reserve, call, settle; a STARTED and a SUCCEEDED/FAILED event either side and
 * the run cost ledger updated. Budget denial and an all-open breaker block the
 * run (they need a human); anything else bubbles up as retryable.
 */
export async function callModel(ctx: PipelineContext, input: ModelCallInput): Promise<ModelCallResult> {
  const prompt = getPrompt(input.promptKey);
  const decision = await resolveProvider(ctx, input.capability, input.pref);
  const base = {
    step: input.step,
    provider: decision.provider,
    model: decision.model,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    promptHash: prompt.hash,
  } as const;
  const estimate = estimateCallCents(
    ctx.router,
    decision.provider,
    decision.model,
    estimateTokens(`${input.system}\n${input.user}`),
    input.expectedOutputTokens ?? DEFAULT_OUTPUT_TOKENS,
  );
  await ctx.store.addEvent(input.runId, {
    ...base,
    status: "STARTED",
    input: truncate(`${input.system}\n\n${input.user}`),
  });
  const reservation = await ctx.budget.reserve(input.organizationId, input.runId, estimate);
  if ("denied" in reservation) {
    await ctx.store.addEvent(input.runId, { ...base, status: "FAILED", error: reservation.denied });
    throw new PipelineBlocked(reservation.denied);
  }
  try {
    const attempt = await execute(ctx, input, decision);
    const costCents = usageToCents(ctx.router, decision.provider, decision.model, attempt.usage);
    await ctx.budget.settle(reservation.reservationId, costCents);
    await ctx.health.recordSuccess(decision.provider, attempt.latencyMs);
    await ctx.store.addCost(input.runId, costCents);
    await ctx.store.addEvent(input.runId, {
      ...base,
      status: "SUCCEEDED",
      output: truncate(attempt.text),
      costCents,
      latencyMs: attempt.latencyMs,
    });
    return {
      text: attempt.text,
      usage: attempt.usage,
      provider: decision.provider,
      model: decision.model,
      costCents,
      latencyMs: attempt.latencyMs,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      promptHash: prompt.hash,
    };
  } catch (error) {
    await ctx.health.recordFailure(decision.provider, errorMessage(error));
    await ctx.budget.release(reservation.reservationId);
    await ctx.store.addEvent(input.runId, { ...base, status: "FAILED", error: errorMessage(error) });
    throw error;
  }
}

/** `callModel` in JSON mode with schema validation; a parse failure is recorded before it bubbles up. */
export async function callJson<T>(
  ctx: PipelineContext,
  input: Omit<ModelCallInput, "capability" | "json">,
  schema: z.ZodType<T>,
): Promise<{ value: T; call: ModelCallResult }> {
  const call = await callModel(ctx, { ...input, capability: "json", json: true });
  try {
    return { value: parseJsonOutput(schema, call.text), call };
  } catch (error) {
    await ctx.store.addEvent(input.runId, {
      step: input.step,
      status: "FAILED",
      promptKey: call.promptKey,
      promptVersion: call.promptVersion,
      promptHash: call.promptHash,
      provider: call.provider,
      model: call.model,
      validation: errorMessage(error),
    });
    throw error;
  }
}
