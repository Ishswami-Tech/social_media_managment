import { z } from "zod";
import { AI_CAPABILITIES, AI_PROVIDERS } from "@platform/types";
import { json, parseBody, withSuperAdmin } from "@/lib/api";
import { aiProvider } from "@/lib/ai";
import { auditPlatform } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const GET = (req: Request) =>
  withSuperAdmin(req, async () => {
    const env = getEnv();
    const models = await prisma.aIProviderConfig.findMany({ orderBy: [{ provider: "asc" }, { priority: "asc" }] });
    const keys = { OPENAI: !!env.OPENAI_API_KEY, ANTHROPIC: !!env.ANTHROPIC_API_KEY, GOOGLE: !!env.GOOGLE_AI_API_KEY };
    return json({ models, platformKeys: keys });
  });

/** Refresh AI models from provider APIs (live model lists). */
export const PATCH = (req: Request) =>
  withSuperAdmin(req, async () => {
    const env = getEnv();
    let totalAdded = 0;

    if (env.ANTHROPIC_API_KEY) {
      try {
        const impl = aiProvider("ANTHROPIC");
        const models = await impl.listModels!({ apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL });
        const existing = await prisma.aIProviderConfig.findMany({ where: { provider: "ANTHROPIC" } });
        const existingSet = new Set(existing.map((m) => m.model));
        for (const m of models) {
          if (existingSet.has(m.id)) continue;
          await prisma.aIProviderConfig.create({
            data: { provider: "ANTHROPIC", model: m.id, displayName: m.displayName, capabilities: m.capabilities, priority: 100 },
          });
          totalAdded++;
        }
      } catch (e) {
        return json({ ok: false, message: `Anthropic: ${(e as Error).message}` }, { status: 500 });
      }
    }

    if (env.OPENAI_API_KEY) {
      try {
        const impl = aiProvider("OPENAI");
        const models = await impl.listModels!({ apiKey: env.OPENAI_API_KEY });
        const existing = await prisma.aIProviderConfig.findMany({ where: { provider: "OPENAI" } });
        const existingSet = new Set(existing.map((m) => m.model));
        const textLike = ["gpt", "o1", "o3", "o4"];
        for (const m of models) {
          if (existingSet.has(m.id)) continue;
          if (!textLike.some((p) => m.id.toLowerCase().startsWith(p))) continue;
          await prisma.aIProviderConfig.create({
            data: { provider: "OPENAI", model: m.id, displayName: m.displayName, capabilities: m.capabilities, priority: 100 },
          });
          totalAdded++;
        }
      } catch { /* non-fatal */ }
    }

    if (env.GOOGLE_AI_API_KEY) {
      try {
        const impl = aiProvider("GOOGLE");
        const models = await impl.listModels!({ apiKey: env.GOOGLE_AI_API_KEY });
        const existing = await prisma.aIProviderConfig.findMany({ where: { provider: "GOOGLE" } });
        const existingSet = new Set(existing.map((m) => m.model));
        for (const m of models) {
          if (existingSet.has(m.id)) continue;
          await prisma.aIProviderConfig.create({
            data: { provider: "GOOGLE", model: m.id, displayName: m.displayName, capabilities: m.capabilities, priority: 100 },
          });
          totalAdded++;
        }
      } catch { /* non-fatal */ }
    }

    return json({ ok: true, added: totalAdded });
  });

const upsert = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100),
  capabilities: z.array(z.enum(AI_CAPABILITIES)).min(1),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  priority: z.number().int().default(100),
  inputCostPerM: z.number().min(0).default(0),
  outputCostPerM: z.number().min(0).default(0),
  imageCost: z.number().min(0).default(0),
});

export const PUT = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const input = await parseBody(req, upsert);
    if (input.isDefault)
      await prisma.aIProviderConfig.updateMany({
        where: { isDefault: true, capabilities: { hasSome: input.capabilities } },
        data: { isDefault: false },
      });
    const row = await prisma.aIProviderConfig.upsert({
      where: { provider_model: { provider: input.provider, model: input.model } },
      create: input,
      update: input,
    });
    await auditPlatform(session.user.id, "admin.ai_model.upsert", "AIProviderConfig", row.id, {
      provider: input.provider,
      model: input.model,
    });
    return json({ model: row });
  });

/** Health-check a provider with the platform key. */
export const POST = (req: Request) =>
  withSuperAdmin(req, async () => {
    const { provider } = await parseBody(req, z.object({ provider: z.enum(AI_PROVIDERS) }));
    const env = getEnv();
    const key =
      provider === "OPENAI"
        ? env.OPENAI_API_KEY
        : provider === "ANTHROPIC"
          ? env.ANTHROPIC_API_KEY
          : env.GOOGLE_AI_API_KEY;
    if (!key) return json({ ok: false, message: "No platform key configured" });
    return json((await aiProvider(provider).healthCheck?.({ apiKey: key })) ?? { ok: true });
  });
