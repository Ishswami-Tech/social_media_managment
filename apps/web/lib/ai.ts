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
import { HuggingFaceProvider, PollinationsProvider } from "@platform/ai-free-images";
import { GoogleProvider } from "@platform/ai-google";
import { OpenAIProvider } from "@platform/ai-openai";
import { MetaProvider } from "@platform/ai-meta";
import type { AICapability, AIProviderName } from "@platform/types";
import { createHash } from "node:crypto";
import { keyring, prisma } from "./db";
import { getEnv } from "./env";
import { errorInfo, logger } from "./logger";

const realProviders = new Map<AIProviderName, AIProvider>([
  ["OPENAI", new OpenAIProvider()],
  ["ANTHROPIC", new AnthropicProvider()],
  ["GOOGLE", new GoogleProvider()],
  ["META", new MetaProvider()],
  ["HUGGINGFACE", new HuggingFaceProvider()],
  ["POLLINATIONS", new PollinationsProvider()],
]);

function providerImpls(): Map<AIProviderName, AIProvider> {
  return realProviders;
}

export function aiProvider(name: AIProviderName): AIProvider {
  return providerImpls().get(name)!;
}

export async function modelCatalogue(): Promise<ModelInfo[]> {
  const rows = await prisma.aIProviderConfig.findMany({ where: { active: true }, orderBy: { priority: "asc" } });
  // The catalogue's own capabilities are read through the same sorting as live listings: an image model is
  // never a content model, and audio, video, embedding and moderation rows are left out.
  return rows
    .map((r) => ({
      provider: r.provider,
      model: r.model,
      capabilities: classifyModel(r.model, r.capabilities as AICapability[]),
      inputCostPerM: r.inputCostPerM,
      outputCostPerM: r.outputCostPerM,
      imageCost: r.imageCost,
    }))
    .filter((m) => m.capabilities.length > 0);
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
  if (n.includes("meta") || n.includes("muse") || n.includes("llama")) return "META";
  if (n.includes("hugging") || n === "hf" || n.startsWith("hf ")) return "HUGGINGFACE";
  if (n.includes("pollinations")) return "POLLINATIONS";
  return "OPENAI";
}

/** Additional data bound to a platform connection's encrypted key so a stolen envelope is not portable. */
export function platformConnectionAad(id: string): string {
  return `platform-ai-conn:${id}`;
}

/** Parses the optional JSON allow-list stored on a connection; malformed values fall back to discovery. */
function parseModelList(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}

/** A credential the platform itself owns: an admin-managed connection, or an environment key. */
export interface PlatformAISource {
  /** `connection:<name>` for a stored connection, `env` for an environment key. */
  origin: string;
  provider: AIProviderName;
  auth: ProviderAuth;
  /** Explicit allow-list from the connection; when present it replaces live discovery. */
  models?: string[];
  /** Cache scope for live model listings. */
  scope: string;
}

/**
 * Platform credentials in precedence order: every enabled connection (oldest
 * first, so the first row for a provider is the one routing uses), then the
 * environment keys — but only for providers that no connection covers.
 */
export async function platformAISources(): Promise<PlatformAISource[]> {
  const env = getEnv();
  const rows = await prisma.platformAIConnection.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const sources: PlatformAISource[] = [];
  const covered = new Set<AIProviderName>();

  for (const row of rows) {
    const provider = normalizeProvider(row.provider);
    let apiKey: string;
    try {
      apiKey = keyring().decrypt(row.apiKeyEncrypted, platformConnectionAad(row.id));
    } catch (e) {
      logger.error("platform AI connection key could not be decrypted", { connectionId: row.id, ...errorInfo(e) });
      continue;
    }
    covered.add(provider);
    sources.push({
      origin: `connection:${row.name}`,
      provider,
      auth: row.baseUrl ? { apiKey, baseUrl: row.baseUrl } : { apiKey },
      models: parseModelList(row.models),
      scope: `platform-conn:${row.id}`,
    });
  }

  const envKeys: [AIProviderName, string | undefined, string | undefined][] = [
    ["OPENAI", env.OPENAI_API_KEY, undefined],
    ["ANTHROPIC", env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL],
    ["GOOGLE", env.GOOGLE_AI_API_KEY, undefined],
    ["META", env.META_API_KEY, env.META_BASE_URL],
    ["HUGGINGFACE", env.HUGGINGFACE_API_KEY, undefined],
    // Pollinations needs no key: on by default as the image provider of last resort.
    ["POLLINATIONS", env.POLLINATIONS_ENABLED === "false" ? undefined : (env.POLLINATIONS_API_KEY ?? ""), undefined],
  ];
  for (const [provider, apiKey, baseUrl] of envKeys) {
    if (apiKey === undefined || covered.has(provider)) continue;
    if (!apiKey && provider !== "POLLINATIONS") continue;
    sources.push({
      origin: "env",
      provider,
      auth: baseUrl ? { apiKey, baseUrl } : { apiKey },
      scope: "platform-env",
    });
  }
  return sources;
}

export interface LiveModel {
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

/** Drops every cached listing so the next discovery goes back to the provider APIs. */
export function clearLiveModelCache(): void {
  liveModelCache().clear();
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

const IMAGE_MODEL = /image|imagen|dall-e|nano-banana|flux|stable-diffusion|sdxl|sd3|midjourney|ideogram/i;
const NOT_A_CONTENT_MODEL = /audio|tts|speech|transcri|whisper|realtime|lyria|music|video|veo|sora|embed|moderation|omni-.*audio|rerank/i;

/**
 * What a listed model is for, read from its name: image models make images
 * and never write posts; audio, video, embedding and moderation models do
 * neither here. Everything else is a content model. A listing that already
 * says "image" is trusted.
 */
export function classifyModel(id: string, reported: readonly string[]): AICapability[] {
  const said = new Set(reported as AICapability[]);
  if (said.has("image") && !said.has("text")) return ["image"];
  if (IMAGE_MODEL.test(id)) return ["image"];
  if (NOT_A_CONTENT_MODEL.test(id)) return [];
  return normalizeCapabilities(reported.length > 0 ? [...reported] : ["text"]);
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
      .map((m) => ({ id: m.id, displayName: m.displayName, capabilities: classifyModel(m.id, m.capabilities) }))
      .filter((m) => m.capabilities.length > 0);
    cache.set(cacheKey, { at: Date.now(), models });
    return models;
  } catch (e) {
    logger.warn("live model discovery failed", { provider, baseUrl: auth.baseUrl, ...errorInfo(e) });
    return undefined;
  }
}

/** What a platform source currently serves: its allow-list when it has one, otherwise a live listing. */
export async function platformSourceModels(source: PlatformAISource): Promise<LiveModel[]> {
  if (source.models)
    return source.models.map((id) => ({ id, displayName: id, capabilities: classifyModel(id, DEFAULT_TEXT_CAPABILITIES) })).filter((m) => m.capabilities.length > 0);
  return (await listLiveModels(source.provider, source.auth, source.scope)) ?? [];
}

/**
 * Models discovered straight from provider APIs, nothing hard-coded. Gateways
 * and keys configured by the organization take precedence: when one exists
 * for a provider, the platform's models for that provider are not offered.
 * A connection with an explicit model list uses that list instead of discovery.
 */
export async function discoverModels(organizationId: string): Promise<SelectableModel[]> {
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
        models = ids.map((id) => ({ id, displayName: id, capabilities: classifyModel(id, DEFAULT_TEXT_CAPABILITIES) })).filter((m) => m.capabilities.length > 0);
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

  for (const source of await platformAISources()) {
    if (orgProviders.has(source.provider)) continue;
    for (const m of await platformSourceModels(source))
      push({
        provider: source.provider,
        model: m.id,
        displayName: m.displayName,
        capabilities: m.capabilities,
        source: "platform",
      });
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
 * Resolves the API key for a provider. Organization sources win: its own
 * connections (custom URLs) first, then its BYO key. Failing that the platform
 * answers — the first enabled platform connection for that provider, and only if
 * there is none, the environment key. Keys never leave the server.
 */
export async function resolveAuth(
  organizationId: string,
): Promise<{
  resolver: (p: AIProviderName) => Promise<ProviderAuth | undefined>;
  available: AIProviderName[];
}> {
  const [orgKeys, connections, platformSources] = await Promise.all([
    prisma.organizationAIKey.findMany({ where: { organizationId, active: true } }),
    prisma.organizationAIConnection.findMany({ where: { organizationId, isActive: true } }),
    platformAISources(),
  ]);
  const available = new Set<AIProviderName>();
  for (const k of orgKeys) available.add(k.provider);
  for (const c of connections) available.add(normalizeProvider(c.provider));
  for (const s of platformSources) available.add(s.provider);

  return {
    available: [...available],
    resolver: async (provider) => {
      // Connection wins (custom base URL). Provider names are free text, so match them normalised.
      const conn = connections.find((c) => normalizeProvider(c.provider) === provider);
      if (conn) {
        return {
          apiKey: keyring().decrypt(conn.apiKeyEncrypted, `ai-conn:${organizationId}:${conn.name}`),
          baseUrl: conn.baseUrl,
        };
      }
      // Then the organization's BYO key (only for known providers).
      const own = orgKeys.find((k) => k.provider === provider);
      if (own) return { apiKey: keyring().decrypt(own.keyEncrypted, `ai-key:${organizationId}:${provider}`) };
      // Finally the platform: connections are already ordered ahead of environment keys.
      return platformSources.find((s) => s.provider === provider)?.auth;
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
