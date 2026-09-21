import type { AICapability, AIProviderName } from "@platform/types";
import { AIError } from "./errors";
import type {
  AIProvider,
  ModelInfo,
  ProviderAuth,
  RouteDecision,
  RoutingContext,
  TextRequest,
  TextResponse,
} from "./types";

/**
 * Chooses provider+model in the order user > organization > platform > auto
 * (spec §11). "auto" picks the cheapest active model with the required
 * capability among providers we hold a key for. Every decision carries an
 * ordered fallback list so the executor can fail over on transient errors.
 */
export class ModelRouter {
  constructor(private readonly catalogue: ModelInfo[]) {}

  route(ctx: RoutingContext): RouteDecision {
    const candidates = this.catalogue
      .filter((m) => m.capabilities.includes(ctx.requiredCapability))
      .filter((m) => ctx.availableProviders.includes(m.provider))
      .sort((a, b) => costOf(a) - costOf(b));
    if (candidates.length === 0) {
      throw new AIError(`No available model with capability "${ctx.requiredCapability}"`, "INVALID_REQUEST", false);
    }
    const tryPref = (pref: RoutingContext["user"], reason: RouteDecision["reason"]): RouteDecision | undefined => {
      if (!pref?.provider && !pref?.model) return undefined;
      const match = candidates.find(
        (m) => (!pref.provider || m.provider === pref.provider) && (!pref.model || m.model === pref.model),
      );
      if (!match) return undefined;
      return {
        provider: match.provider,
        model: match.model,
        reason,
        fallbacks: this.fallbacksFor(match, candidates, ctx),
      };
    };
    const decided =
      tryPref(ctx.user, "user") ?? tryPref(ctx.organization, "organization") ?? tryPref(ctx.platform, "platform");
    if (decided) return decided;
    const auto = candidates[0]!;
    return {
      provider: auto.provider,
      model: auto.model,
      reason: "auto",
      fallbacks: this.fallbacksFor(auto, candidates, ctx),
    };
  }

  private fallbacksFor(chosen: ModelInfo, candidates: ModelInfo[], ctx: RoutingContext) {
    if (!ctx.allowFallback) return [];
    const others = candidates.filter((c) => c !== chosen);
    const different = others.filter((c) => c.provider !== chosen.provider);
    const same = others.filter((c) => c.provider === chosen.provider);
    return [...different, ...same].slice(0, 3).map((c) => ({ provider: c.provider, model: c.model }));
  }

  estimateCost(
    provider: AIProviderName,
    model: string,
    usage: { inputTokens?: number; outputTokens?: number; images?: number },
  ): number {
    const info = this.catalogue.find((m) => m.provider === provider && m.model === model);
    if (!info) return 0;
    const inCost = ((usage.inputTokens ?? 0) / 1_000_000) * (info.inputCostPerM ?? 0);
    const outCost = ((usage.outputTokens ?? 0) / 1_000_000) * (info.outputCostPerM ?? 0);
    const imgCost = (usage.images ?? 0) * (info.imageCost ?? 0);
    return Number((inCost + outCost + imgCost).toFixed(6));
  }
}

function costOf(m: ModelInfo): number {
  return (m.inputCostPerM ?? 0) + (m.outputCostPerM ?? 0) * 3 + (m.imageCost ?? 0) * 1000;
}

export type AuthResolver = (provider: AIProviderName) => Promise<ProviderAuth | undefined> | ProviderAuth | undefined;

export interface ExecutorHooks {
  onUsage?: (event: {
    provider: AIProviderName;
    model: string;
    operation?: string;
    usage: TextResponse["usage"];
    latencyMs: number;
    cost: number;
    success: boolean;
    errorCode?: string;
  }) => Promise<void> | void;
}

/**
 * Executes a routed text request with automatic failover. Providers are
 * injected so the executor is fully testable without network access.
 */
export class AIExecutor {
  constructor(
    private readonly providers: Map<AIProviderName, AIProvider>,
    private readonly router: ModelRouter,
    private readonly resolveAuth: AuthResolver,
    private readonly hooks: ExecutorHooks = {},
  ) {}

  async text(
    ctx: Omit<RoutingContext, "requiredCapability"> & { requiredCapability?: AICapability },
    req: Omit<TextRequest, "model">,
  ): Promise<TextResponse & { decision: RouteDecision }> {
    const decision = this.router.route({
      ...ctx,
      requiredCapability: ctx.requiredCapability ?? (req.json ? "json" : "text"),
    });
    const attempts = [{ provider: decision.provider, model: decision.model }, ...decision.fallbacks];
    let lastError: unknown;
    for (const attempt of attempts) {
      const provider = this.providers.get(attempt.provider);
      const auth = await this.resolveAuth(attempt.provider);
      if (!provider || !auth) continue;
      try {
        const res = await provider.generateText({ ...req, model: attempt.model }, auth);
        const cost = this.router.estimateCost(attempt.provider, attempt.model, res.usage);
        await this.hooks.onUsage?.({
          provider: attempt.provider,
          model: attempt.model,
          operation: req.operation,
          usage: res.usage,
          latencyMs: res.latencyMs,
          cost,
          success: true,
        });
        return { ...res, decision: { ...decision, provider: attempt.provider, model: attempt.model } };
      } catch (e) {
        lastError = e;
        const code = e instanceof AIError ? e.code : "UNKNOWN";
        await this.hooks.onUsage?.({
          provider: attempt.provider,
          model: attempt.model,
          operation: req.operation,
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          cost: 0,
          success: false,
          errorCode: code,
        });
        if (e instanceof AIError && !e.retryable) throw e;
      }
    }
    throw lastError ?? new AIError("No provider could handle the request", "PROVIDER_UNAVAILABLE", true);
  }
}
