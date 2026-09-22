import type { PipelineContext } from "@platform/agent-council";
import type { Prisma } from "@platform/database";
import { aiRuntime } from "@/lib/ai";
import { createPrismaBudget } from "@/lib/agent/budget";
import { createPrismaProviderHealth } from "@/lib/agent/provider-health";
import { createPrismaRunStore } from "@/lib/agent/store";
import { prisma } from "@/lib/db";
import { pluginTools } from "@/lib/plugins";
import { buildOrgResearchTools } from "@/lib/research";

/** Published texts compared by the duplicate check (spec: last 50). */
const RECENT_TEXTS_LIMIT = 50;

/** `OrganizationSettings.agentAllowedModels` is a JSON array of "PROVIDER::model" strings, or null for "any". */
export function parseAllowedModels(value: Prisma.JsonValue | null | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models = value.filter((v): v is string => typeof v === "string" && v.includes("::"));
  return models.length > 0 ? models : undefined;
}

async function recentPublishedTexts(organizationId: string): Promise<string[]> {
  const rows = await prisma.postVariant.findMany({
    where: { post: { organizationId }, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: RECENT_TEXTS_LIMIT,
    select: { text: true },
  });
  return rows.map((r) => r.text);
}

/**
 * Everything the pipeline needs to run one organization's campaign: the AI
 * runtime (keys never leave the server), tenant-scoped research and plugin
 * tools, and the Prisma-backed ports.
 */
export async function buildPipelineContext(organizationId: string): Promise<PipelineContext> {
  const [ai, settings, researchTools, plugins, recentTexts] = await Promise.all([
    aiRuntime(organizationId),
    prisma.organizationSettings.findUnique({ where: { organizationId }, select: { agentAllowedModels: true } }),
    buildOrgResearchTools(organizationId),
    pluginTools(organizationId),
    recentPublishedTexts(organizationId),
  ]);
  return {
    executor: ai.executor,
    router: ai.router,
    routing: async (capability, pref) => {
      const ctx = await ai.routing(capability, pref);
      return { ...ctx, requiredCapability: capability };
    },
    availableProviders: ai.available,
    allowedModels: parseAllowedModels(settings?.agentAllowedModels),
    researchTools: [...researchTools, ...plugins],
    store: createPrismaRunStore(),
    budget: createPrismaBudget(),
    health: createPrismaProviderHealth(),
    recentTexts,
  };
}
