import {
  AIExecutor,
  ContentOperations,
  ModelRouter,
  type AIProvider,
  type ImageRequest,
  type ModelInfo,
  type ProviderAuth,
  type RoutingContext,
} from "@platform/ai-core";
import { AnthropicProvider } from "@platform/ai-anthropic";
import { GoogleProvider } from "@platform/ai-google";
import { OpenAIProvider } from "@platform/ai-openai";
import type { AICapability, AIProviderName } from "@platform/types";
import { keyring, prisma } from "./db";
import { getEnv } from "./env";

const providerImpls = new Map<AIProviderName, AIProvider>([
  ["OPENAI", new OpenAIProvider()],
  ["ANTHROPIC", new AnthropicProvider()],
  ["GOOGLE", new GoogleProvider()],
]);

export function aiProvider(name: AIProviderName): AIProvider {
  return providerImpls.get(name)!;
}

export async function modelCatalogue(): Promise<ModelInfo[]> {
  const rows = await prisma.aIProviderConfig.findMany({ where: { active: true }, orderBy: { priority: "asc" } });
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    capabilities: r.capabilities as AICapability[],
    inputCostPerM: r.inputCostPerM,
    outputCostPerM: r.outputCostPerM,
    imageCost: r.imageCost,
  }));
}

export async function platformDefault(
  capability: AICapability,
): Promise<{ provider: AIProviderName; model: string } | undefined> {
  const row = await prisma.aIProviderConfig.findFirst({
    where: { active: true, isDefault: true, capabilities: { has: capability } },
    orderBy: { priority: "asc" },
  });
  return row ? { provider: row.provider, model: row.model } : undefined;
}

/**
 * Resolves the API key for a provider: the organization's own key (BYO) wins,
 * otherwise the platform key from the environment. Keys never leave the server.
 */
export async function resolveAuth(
  organizationId: string,
): Promise<{ resolver: (p: AIProviderName) => Promise<ProviderAuth | undefined>; available: AIProviderName[] }> {
  const env = getEnv();
  const orgKeys = await prisma.organizationAIKey.findMany({ where: { organizationId, active: true } });
  const platformKeys: Partial<Record<AIProviderName, string>> = {
    OPENAI: env.OPENAI_API_KEY,
    ANTHROPIC: env.ANTHROPIC_API_KEY,
    GOOGLE: env.GOOGLE_AI_API_KEY,
  };
  const available = new Set<AIProviderName>();
  for (const k of orgKeys) available.add(k.provider);
  for (const [p, v] of Object.entries(platformKeys)) if (v) available.add(p as AIProviderName);
  return {
    available: [...available],
    resolver: async (provider) => {
      const own = orgKeys.find((k) => k.provider === provider);
      if (own) return { apiKey: keyring().decrypt(own.keyEncrypted, `ai-key:${organizationId}:${provider}`) };
      const platform = platformKeys[provider];
      return platform ? { apiKey: platform } : undefined;
    },
  };
}

export interface AIRuntime {
  executor: AIExecutor;
  ops: ContentOperations;
  router: ModelRouter;
  routing: (
    capability?: AICapability,
    user?: { provider?: AIProviderName; model?: string },
  ) => Promise<Omit<RoutingContext, "requiredCapability"> & { requiredCapability?: AICapability }>;
  available: AIProviderName[];
  image: (req: Omit<ImageRequest, "model"> & { user?: { provider?: AIProviderName; model?: string } }) => Promise<{
    images: { base64?: string; url?: string; mimeType: string }[];
    provider: AIProviderName;
    model: string;
  }>;
}

/** Builds a per-request AI runtime bound to one organization (keys, defaults, metering). */
export async function aiRuntime(
  organizationId: string,
  userId?: string,
  opts: { retainPrompts?: boolean } = {},
): Promise<AIRuntime> {
  const [catalogue, { resolver, available }, settings] = await Promise.all([
    modelCatalogue(),
    resolveAuth(organizationId),
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
  ]);
  const router = new ModelRouter(catalogue);
  const executor = new AIExecutor(providerImpls, router, resolver, {
    onUsage: async (e) => {
      await prisma.aIUsage.create({
        data: {
          organizationId,
          userId: userId ?? null,
          provider: e.provider,
          model: e.model,
          operation: e.operation ?? "GENERATE",
          inputTokens: e.usage.inputTokens,
          outputTokens: e.usage.outputTokens,
          estimatedCost: e.cost,
          latencyMs: e.latencyMs,
          success: e.success,
          errorCode: e.errorCode ?? null,
        },
      });
    },
  });
  const orgPref = (cap: AICapability) =>
    cap === "image"
      ? {
          provider: (settings?.aiImageProvider as AIProviderName | null) ?? undefined,
          model: settings?.aiImageModel ?? undefined,
        }
      : {
          provider: (settings?.aiDefaultProvider as AIProviderName | null) ?? undefined,
          model: settings?.aiDefaultModel ?? undefined,
        };

  const routing: AIRuntime["routing"] = async (capability = "text", user) => ({
    user,
    organization: orgPref(capability),
    platform: await platformDefault(capability),
    availableProviders: available,
    allowFallback: true,
    requiredCapability: capability,
  });

  void opts;
  return {
    executor,
    ops: new ContentOperations(executor),
    router,
    routing,
    available,
    image: async (req) => {
      const ctx = await routing("image", req.user);
      const decision = router.route({ ...ctx, requiredCapability: "image" });
      const attempts = [{ provider: decision.provider, model: decision.model }, ...decision.fallbacks];
      let lastError: unknown;
      for (const a of attempts) {
        const impl = providerImpls.get(a.provider);
        const auth = await resolver(a.provider);
        if (!impl?.generateImage || !auth) continue;
        const started = Date.now();
        try {
          const res = await impl.generateImage({ ...req, model: a.model }, auth);
          await prisma.aIUsage.create({
            data: {
              organizationId,
              userId: userId ?? null,
              provider: a.provider,
              model: a.model,
              operation: "IMAGE",
              imageCount: res.images.length,
              estimatedCost: router.estimateCost(a.provider, a.model, { images: res.images.length }),
              latencyMs: Date.now() - started,
              success: true,
            },
          });
          return { images: res.images, provider: a.provider, model: a.model };
        } catch (e) {
          lastError = e;
          await prisma.aIUsage.create({
            data: {
              organizationId,
              userId: userId ?? null,
              provider: a.provider,
              model: a.model,
              operation: "IMAGE",
              success: false,
              errorCode: (e as { code?: string }).code ?? "UNKNOWN",
              latencyMs: Date.now() - started,
            },
          });
          if ((e as { retryable?: boolean }).retryable === false) throw e;
        }
      }
      throw lastError ?? new Error("No image provider available");
    },
  };
}
