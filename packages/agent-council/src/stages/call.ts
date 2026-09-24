/**
 * Every model call of the pipeline goes through here so routing, the circuit
 * breaker, the budget and the replay events stay consistent and no stage can
 * spend money without a reservation or without leaving a trace.
 */
import type { AICapability, AIProviderName } from "@platform/types";
import { AIError, parseJsonOutput, runAgent, type RoutingContext, type Tool, type Usage } from "@platform/ai-core";
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

/** Error codes that describe the provider's day, not the request: another provider can take the call. */
const FAILOVER_CODES = new Set(["RATE_LIMITED", "PROVIDER_UNAVAILABLE", "TIMEOUT"]);

/** Quota exhausted, overloaded or unreachable provider; safe to hand the same call to another one. */
export function isProviderFailure(error: unknown): boolean {
  return error instanceof AIError && error.retryable && FAILOVER_CODES.has(error.code);
}

/**
 * The model, not the provider, is the problem (retired, closed to this account,
 * no tool support): a 4xx other than 429 that the provider layer still marked
 * retryable. Such failures do not count against the provider's circuit breaker.
 */
export function isModelFailure(error: unknown): boolean {
  return (
    error instanceof AIError &&
    error.code === "PROVIDER_UNAVAILABLE" &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
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
  /** "PROVIDER::model" pairs other writers of the same account use; avoided while any other model is available. */
  avoidModels?: readonly string[];
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
/** Prefers a model no sibling writer uses; when only those remain, uses them rather than failing. */
async function resolveProviderAvoiding(
  ctx: PipelineContext,
  input: ModelCallInput,
  excluded: ReadonlySet<AIProviderName>,
  excludedModels: readonly string[],
  stayWith?: AIProviderName,
): Promise<ModelDecision> {
  const avoid = (input.avoidModels ?? []).filter((m) => !excludedModels.includes(m));
  if (avoid.length > 0) {
    try {
      return await resolveProvider(ctx, input.capability, input.pref, excluded, [...excludedModels, ...avoid], stayWith);
    } catch (error) {
      if (!(error instanceof PipelineBlocked)) throw error;
    }
  }
  return resolveProvider(ctx, input.capability, input.pref, excluded, excludedModels, stayWith);
}

/** How many models of one provider a single call may burn before moving to the next provider. */
const MODELS_PER_PROVIDER = 2;

export async function resolveProvider(
  ctx: PipelineContext,
  capability: "text" | "json",
  pref?: ProviderPreference,
  excluded: ReadonlySet<AIProviderName> = new Set(),
  excludedModels: readonly string[] = [],
  /** Provider that just failed on one model: tried first again, with its next model. */
  stayWith?: AIProviderName,
): Promise<ModelDecision> {
  const seen = new Set<string>();
  const dead = ctx.deadModels ? [...ctx.deadModels] : [];
  excludedModels = dead.length > 0 ? [...new Set([...excludedModels, ...dead])] : excludedModels;
  const order = stayWith && !excluded.has(stayWith) ? [{ provider: stayWith }, ...candidatePreferences(ctx, pref)] : candidatePreferences(ctx, pref);
  for (const candidate of order) {
    if (candidate?.provider && excluded.has(candidate.provider)) continue;
    const routing = await ctx.routing(capability, candidate);
    let provider: AIProviderName;
    let model: string;
    try {
      // A pinned model that already failed must not be re-picked: drop the pin and let auto choose within the provider.
      const pinned = candidate?.model ? `${candidate.provider}::${candidate.model}` : undefined;
      const user = pinned && excludedModels.includes(pinned) ? { provider: candidate?.provider } : routing.user;
      const decision = ctx.router.route({ ...routing, user, requiredCapability: capability, excludeModels: excludedModels });
      provider = decision.provider;
      model = decision.model;
    } catch {
      continue;
    }
    const key = `${provider}::${model}`;
    if (seen.has(key) || excluded.has(provider) || excludedModels.includes(key)) continue;
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
 * run (they need a human). A provider that is out of quota, overloaded or
 * unreachable hands the call to the next available provider; anything else
 * bubbles up as retryable.
 */
export async function callModel(ctx: PipelineContext, input: ModelCallInput): Promise<ModelCallResult> {
  const prompt = getPrompt(input.promptKey);
  const excluded = new Set<AIProviderName>();
  const excludedModels: string[] = [];
  const burned = new Map<AIProviderName, number>();
  let stayWith: AIProviderName | undefined;
  let lastError: unknown;
  for (;;) {
    let decision: ModelDecision;
    try {
      decision = await resolveProviderAvoiding(ctx, input, excluded, excludedModels, stayWith);
    } catch (error) {
      // Nothing left to try: the provider's own error explains it better than "unavailable".
      if (lastError !== undefined && error instanceof PipelineBlocked) throw lastError;
      throw error;
    }
    try {
      return await callProvider(ctx, input, prompt, decision);
    } catch (error) {
      if (!isProviderFailure(error)) throw error;
      lastError = error;
      excludedModels.push(`${decision.provider}::${decision.model}`);
      if (isModelFailure(error)) ctx.deadModels?.add(`${decision.provider}::${decision.model}`);
      const tries = (burned.get(decision.provider) ?? 0) + 1;
      burned.set(decision.provider, tries);
      // Same provider, next model, until it has burned its share; then the next provider.
      if (tries >= MODELS_PER_PROVIDER) excluded.add(decision.provider);
      stayWith = excluded.has(decision.provider) ? undefined : decision.provider;
      const alternative = ctx.availableProviders.some((p) => !excluded.has(p));
      if (!alternative) throw error;
      await ctx.store.addEvent(input.runId, {
        step: input.step,
        status: "STARTED",
        provider: decision.provider,
        model: decision.model,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        promptHash: prompt.hash,
        validation: `${decision.model} could not take the call (${errorMessage(error)}); trying ${stayWith ? "another model" : "another provider"}`,
      });
    }
  }
}

async function callProvider(
  ctx: PipelineContext,
  input: ModelCallInput,
  prompt: ReturnType<typeof getPrompt>,
  decision: ModelDecision,
): Promise<ModelCallResult> {
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
    if (!isModelFailure(error)) await ctx.health.recordFailure(decision.provider, errorMessage(error));
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
      error: `The model's JSON did not match the expected shape: ${errorMessage(error)}`,
      validation: errorMessage(error),
    });
    throw error;
  }
}
