import type { ProviderAuth } from "@platform/ai-core";
import type { AICapability, AIProviderName } from "@platform/types";
import {
  aiProvider,
  normalizeProvider,
  platformAISources,
  platformConnectionAad,
  platformSourceModels,
} from "../ai";
import { keyring, prisma } from "../db";
import { getEnv } from "../env";

/** Last four characters of a stored key — enough to recognise it, useless to an attacker. */
export function keyHint(id: string, encrypted: string): string {
  try {
    return keyring().decrypt(encrypted, platformConnectionAad(id)).slice(-4);
  } catch {
    return "????";
  }
}

/** Provider errors are shown to the admin, so make sure the key can never ride along. */
function redact(message: string, apiKey: string): string {
  const cleaned = apiKey.length >= 8 ? message.split(apiKey).join("***") : message;
  return cleaned.slice(0, 300);
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  modelCount: number;
}

/** Health-checks a credential and counts the models it serves. Never throws. */
export async function testConnection(
  provider: string,
  apiKey: string,
  baseUrl?: string | null,
): Promise<ConnectionTest> {
  const impl = aiProvider(normalizeProvider(provider));
  const auth: ProviderAuth = baseUrl ? { apiKey, baseUrl } : { apiKey };
  try {
    const health = await impl.healthCheck?.(auth);
    if (health && !health.ok)
      return { ok: false, message: redact(health.message ?? "Could not reach the provider", apiKey), modelCount: 0 };
    const models = (await impl.listModels?.(auth)) ?? [];
    return { ok: true, message: `${models.length} models available`, modelCount: models.length };
  } catch (e) {
    return {
      ok: false,
      message: redact(e instanceof Error ? e.message : "Could not reach the provider", apiKey),
      modelCount: 0,
    };
  }
}

export function testStatus(result: ConnectionTest): string {
  return result.ok ? "ok" : `error: ${result.message}`;
}

export interface AdminConnection {
  id: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  models: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  keyHint: string;
}

/** An entry of the admin models table: live discovery plus the optional pricing overlay. */
export interface AdminModel {
  id: string;
  provider: AIProviderName;
  model: string;
  displayName: string;
  capabilities: AICapability[];
  inputCostPerM: number;
  outputCostPerM: number;
  imageCost: number;
  active: boolean;
  isDefault: boolean;
  priority: number;
  /** `connection:<name>` or `env`. */
  source: string;
}

export interface PlatformAIConsole {
  connections: AdminConnection[];
  envProviders: Record<"OPENAI" | "ANTHROPIC" | "GOOGLE", boolean>;
  models: AdminModel[];
}

/**
 * Everything the Super Admin console needs: the stored connections (with a key
 * hint only), which providers the environment still covers, and the models those
 * sources currently serve merged with the AIProviderConfig pricing overlay.
 */
export async function platformAIConsole(): Promise<PlatformAIConsole> {
  const env = getEnv();
  const [rows, overlay, sources] = await Promise.all([
    prisma.platformAIConnection.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.aIProviderConfig.findMany(),
    platformAISources(),
  ]);

  const seen = new Set<string>();
  const models: AdminModel[] = [];
  for (const source of sources) {
    for (const m of await platformSourceModels(source)) {
      const key = `${source.provider}::${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = overlay.find((r) => r.provider === source.provider && r.model === m.id);
      models.push({
        id: key,
        provider: source.provider,
        model: m.id,
        displayName: row?.displayName ?? m.displayName,
        capabilities: [...new Set([...m.capabilities, ...((row?.capabilities ?? []) as AICapability[])])],
        inputCostPerM: row?.inputCostPerM ?? 0,
        outputCostPerM: row?.outputCostPerM ?? 0,
        imageCost: row?.imageCost ?? 0,
        active: row?.active ?? false,
        isDefault: row?.isDefault ?? false,
        priority: row?.priority ?? 100,
        source: source.origin,
      });
    }
  }

  return {
    connections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      baseUrl: r.baseUrl,
      models: r.models,
      enabled: r.enabled,
      lastTestedAt: r.lastTestedAt?.toISOString() ?? null,
      lastTestStatus: r.lastTestStatus,
      keyHint: keyHint(r.id, r.apiKeyEncrypted),
    })),
    envProviders: {
      OPENAI: !!env.OPENAI_API_KEY,
      ANTHROPIC: !!env.ANTHROPIC_API_KEY,
      GOOGLE: !!env.GOOGLE_AI_API_KEY,
    },
    models: models.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
  };
}
