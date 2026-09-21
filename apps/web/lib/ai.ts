import {
  AIExecutor,
  ContentOperations,
  MockProvider,
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
import { createHash } from "node:crypto";
import { keyring, prisma } from "./db";
import { getEnv } from "./env";
import { errorInfo, logger } from "./logger";

const realProviders = new Map<AIProviderName, AIProvider>([
  ["OPENAI", new OpenAIProvider()],
  ["ANTHROPIC", new AnthropicProvider()],
  ["GOOGLE", new GoogleProvider()],
]);
const mockProviders = new Map<AIProviderName, AIProvider>(
  [...realProviders.keys()].map((name) => [name, new MockProvider(name)]),
);

export function aiMockEnabled(): boolean {
  return getEnv().AI_MOCK && getEnv().NODE_ENV !== "production";
}
function providerImpls(): Map<AIProviderName, AIProvider> {
  return aiMockEnabled() ? mockProviders : realProviders;
}

export function aiProvider(name: AIProviderName): AIProvider {
  return providerImpls().get(name)!;
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

export interface SelectableModel {
  provider: AIProviderName;
  model: string;
  displayName: string;
  capabilities: AICapability[];
  /** Where the entry came from: an organization gateway/key, the platform key, or the curated catalogue. */
  source: "organization" | "platform" | "catalogue";
}

/**
 * Maps a free-text connection provider name ("Anthropic", "claude proxy", "Groq"...)
 * onto the provider implementation used to talk to it. Anything unknown is
 * treated as OpenAI-compatible, which is what most gateways and local runtimes speak.
 */
export function normalizeProvider(name: string | null | undefined): AIProviderName {
  const n = (name ?? "").trim().toLowerCase();
  if (n.includes("anthropic") || n.includes("claude")) return "ANTHROPIC";
  if (n.includes("google") || n.includes("gemini")) return "GOOGLE";
  return "OPENAI";
}

interface LiveModel {
  id: string;
  displayName: string;
  capabilities: AICapability[];
}

const LIVE_MODELS_TTL_MS = 10 * 60_000;
const DEFAULT_TEXT_CAPABILITIES: AICapability[] = ["text", "vision", "json"];
/** OpenAI-style listings include audio, moderation and embedding models that cannot write posts. */
const OPENAI_MODEL_PREFIXES = ["gpt", "o1", "o3", "o4", "chatgpt", "dall-e"];

declare global {
  var __platformLiveModels: Map<string, { at: number; models: LiveModel[] }> | undefined;
}

function liveModelCache(): Map<string, { at: number; models: LiveModel[] }> {
  if (!globalThis.__platformLiveModels) globalThis.__platformLiveModels = new Map();
  return globalThis.__platformLiveModels;
}

/** Short, non-reversible fingerprint so cache keys never contain the secret itself. */
function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

/** Every chat model can be prompted for JSON; listings that only say "text" would otherwise be unroutable. */
function normalizeCapabilities(caps: string[]): AICapability[] {
  const set = new Set(caps as AICapability[]);
  if (set.has("text")) set.add("json");
  return [...set];
}

/**
 * Lists the models a provider endpoint currently serves. Results are cached for
 * a few minutes per endpoint+credential; failures return undefined so callers
 * can fall back to the curated catalogue.
 */
async function listLiveModels(
  provider: AIProviderName,
  auth: ProviderAuth,
  scope: string,
): Promise<LiveModel[] | undefined> {
  const cacheKey = `${scope}:${provider}:${auth.baseUrl ?? ""}:${fingerprint(auth.apiKey)}`;
  const cache = liveModelCache();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < LIVE_MODELS_TTL_MS) return hit.models;
  const impl = providerImpls().get(provider);
  if (!impl?.listModels) return undefined;
  try {
    const listed = await impl.listModels(auth);
    const models = listed
      .filter((m) => provider !== "OPENAI" || OPENAI_MODEL_PREFIXES.some((p) => m.id.toLowerCase().startsWith(p)))
      .map((m) => ({ id: m.id, displayName: m.displayName, capabilities: normalizeCapabilities(m.capabilities) }));
    cache.set(cacheKey, { at: Date.now(), models });
    return models;
  } catch (e) {
    logger.warn("live model discovery failed", { provider, baseUrl: auth.baseUrl, ...errorInfo(e) });
    return undefined;
  }
}

/**
 * Models discovered straight from provider APIs, nothing hard-coded. Gateways
 * and keys configured by the organization take precedence: when one exists
 * for a provider, the platform key's models for that provider are not offered.
 * A connection with an explicit model list uses that list instead of discovery.
 */
export async function discoverModels(organizationId: string): Promise<SelectableModel[]> {
  const env = getEnv();
  const [connections, orgKeys] = await Promise.all([
    prisma.organizationAIConnection.findMany({ where: { organizationId, isActive: true } }),
    prisma.organizationAIKey.findMany({ where: { organizationId, active: true } }),
  ]);
  const out: SelectableModel[] = [];
  const seen = new Set<string>();
  const orgProviders = new Set<AIProviderName>();
  const push = (m: SelectableModel) => {
    const key = `${m.provider}::${m.model}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };

  for (const c of connections) {
    const provider = normalizeProvider(c.provider);
    orgProviders.add(provider);
    let models: LiveModel[] | undefined;
    if (c.models) {
      try {
        const ids = JSON.parse(c.models) as string[];
        models = ids.map((id) => ({ id, displayName: id, capabilities: DEFAULT_TEXT_CAPABILITIES }));
      } catch {
        models = undefined;
      }
    }
    if (!models) {
      const apiKey = keyring().decrypt(c.apiKeyEncrypted, `ai-conn:${organizationId}:${c.name}`);
      models = await listLiveModels(provider, { apiKey, baseUrl: c.baseUrl }, `conn:${c.id}`);
    }
    for (const m of models ?? [])
      push({
        provider,
        model: m.id,
        displayName: `${m.displayName} · ${c.name}`,
        capabilities: m.capabilities,
        source: "organization",
      });
  }

  for (const k of orgKeys) {
    orgProviders.add(k.provider);
    const apiKey = keyring().decrypt(k.keyEncrypted, `ai-key:${organizationId}:${k.provider}`);
    const models = await listLiveModels(k.provider, { apiKey }, `org:${organizationId}`);
    for (const m of models ?? [])
      push({ provider: k.provider, model: m.id, displayName: m.displayName, capabilities: m.capabilities, source: "organization" });
  }

  const platform: [AIProviderName, string | undefined, string | undefined][] = [
    ["ANTHROPIC", env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL],
    ["OPENAI", env.OPENAI_API_KEY, undefined],
    ["GOOGLE", env.GOOGLE_AI_API_KEY, undefined],
  ];
  for (const [provider, apiKey, baseUrl] of platform) {
    if (!apiKey || orgProviders.has(provider)) continue;
    const models = await listLiveModels(provider, { apiKey, baseUrl }, "platform");
    for (const m of models ?? [])
      push({ provider, model: m.id, displayName: m.displayName, capabilities: m.capabilities, source: "platform" });
  }
  return out;
}

/**
 * Models a member of this organization can pick explicitly. Providers that
 * answered a live listing show exactly what they serve (catalogue rows for the
 * same model contribute extra capabilities such as image generation); the
 * curated catalogue is only used for providers that could not be listed.
 */
export async function selectableModels(organizationId: string): Promise<SelectableModel[]> {
  const [{ available }, rows, discovered] = await Promise.all([
    resolveAuth(organizationId),
    prisma.aIProviderConfig.findMany({
      where: { active: true },
      orderBy: [{ provider: "asc" }, { priority: "asc" }],
    }),
    discoverModels(organizationId),
  ]);
  const catalogue = rows.filter((m) => available.includes(m.provider));
  const liveProviders = new Set(discovered.map((m) => m.provider));
  const merged = discovered.map((m) => {
    const row = catalogue.find((r) => r.provider === m.provider && r.model === m.model);
    if (!row) return m;
    const capabilities = [...new Set([...m.capabilities, ...(row.capabilities as AICapability[])])];
    return { ...m, capabilities };
  });
  const fallback: SelectableModel[] = catalogue
    .filter((m) => !liveProviders.has(m.provider))
    .map((m) => ({
      provider: m.provider,
      model: m.model,
      displayName: m.displayName,
      capabilities: m.capabilities as AICapability[],
      source: "catalogue",
    }));
  return [...merged, ...fallback].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.displayName.localeCompare(b.displayName),
  );
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
 * Resolves the API key for a provider: connections (custom URLs) take priority,
 * then the organization's own key (BYO), then the platform key from the environment.
 * Keys never leave the server.
 */
export async function resolveAuth(
  organizationId: string,
): Promise<{
  resolver: (p: AIProviderName) => Promise<ProviderAuth | undefined>;
  available: AIProviderName[];
}> {
  const env = getEnv();
  const orgKeys = await prisma.organizationAIKey.findMany({ where: { organizationId, active: true } });
  const connections = await prisma.organizationAIConnection.findMany({
    where: { organizationId, isActive: true },
  });
  const platformKeys: Partial<Record<AIProviderName, string>> = {
    OPENAI: env.OPENAI_API_KEY,
    ANTHROPIC: env.ANTHROPIC_API_KEY,
    GOOGLE: env.GOOGLE_AI_API_KEY,
  };
  const anthropicBaseUrl = env.ANTHROPIC_BASE_URL;
  const available = new Set<AIProviderName>();
  for (const k of orgKeys) available.add(k.provider);
  for (const c of connections) available.add(normalizeProvider(c.provider));
  for (const [p, v] of Object.entries(platformKeys)) if (v) available.add(p as AIProviderName);
  if (aiMockEnabled()) for (const p of realProviders.keys()) available.add(p);

  return {
    available: [...available],
    resolver: async (provider) => {
      if (aiMockEnabled()) return { apiKey: "mock" };
      // Connection wins (custom base URL). Provider names are free text, so match them normalised.
      const conn = connections.find((c) => normalizeProvider(c.provider) === provider);
      if (conn) {
        return {
          apiKey: keyring().decrypt(conn.apiKeyEncrypted, `ai-conn:${organizationId}:${conn.name}`),
          baseUrl: conn.baseUrl,
        };
      }
      // Then BYO key (only for known providers)
      if (["OPENAI", "ANTHROPIC", "GOOGLE"].includes(provider as AIProviderName)) {
        const own = orgKeys.find((k) => k.provider === provider);
        if (own) return { apiKey: keyring().decrypt(own.keyEncrypted, `ai-key:${organizationId}:${provider}`) };
        const platform = platformKeys[provider];
        if (!platform) return undefined;
        const auth: ProviderAuth = { apiKey: platform };
        if (provider === "ANTHROPIC" && anthropicBaseUrl) auth.baseUrl = anthropicBaseUrl;
        return auth;
      }
      return undefined;
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
  const [catalogue, discovered, { resolver, available }, settings] = await Promise.all([
    modelCatalogue(),
    discoverModels(organizationId),
    resolveAuth(organizationId),
    prisma.organizationSettings.findUnique({ where: { organizationId } }),
  ]);
  // Live models without catalogue pricing are routable when picked explicitly; "auto" still prefers priced rows.
  const known = new Set(catalogue.map((m) => `${m.provider}::${m.model}`));
  const extra: ModelInfo[] = discovered
    .filter((m) => !known.has(`${m.provider}::${m.model}`))
    .map((m) => ({ provider: m.provider, model: m.model, capabilities: m.capabilities }));
  const router = new ModelRouter([...catalogue, ...extra]);
  const impls = providerImpls();
  const executor = new AIExecutor(impls, router, resolver, {
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
        const impl = impls.get(a.provider);
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
              imageCount: 0,
              estimatedCost: 0,
              latencyMs: Date.now() - started,
              success: false,
              errorCode: e instanceof Error ? e.message : "UNKNOWN",
            },
          });
        }
      }
      throw lastError ?? new Error("No image provider available");
    },
  };
}
