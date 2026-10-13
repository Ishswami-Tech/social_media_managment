import type { PipelineContext, SkillCard } from "@platform/agent-council";
import type { Prisma } from "@platform/database";
import { aiRuntime } from "@/lib/ai";
import { createPrismaBudget } from "@/lib/agent/budget";
import { createPrismaProviderHealth } from "@/lib/agent/provider-health";
import { createPrismaRunStore } from "@/lib/agent/store";
import { publishRun } from "@/lib/agent/live";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { pluginTools } from "@/lib/plugins";
import { buildOrgResearchTools } from "@/lib/research";
import { toSkillCard } from "@/lib/agent/skill-cards";

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

/** The model a person pinned for the campaign, if any (skills live on the run snapshot). */
async function preferredModelOf(organizationId: string, runId?: string): Promise<string | null> {
  if (!runId) return null;
  const run = await prisma.agentRun.findFirst({ where: { id: runId, organizationId }, select: { preferredModel: true } });
  return run?.preferredModel ?? null;
}

/** Seats the council may hold. One is a single model per decision; beyond a handful nothing is gained. */
export const COUNCIL_SIZE_MIN = 1;
export const COUNCIL_SIZE_MAX = 5;
const COUNCIL_SIZE_DEFAULT = 3;

/**
 * How many independent models answer each council decision.
 *
 * Seats run together, so width costs money rather than time: three seats is
 * three opinions for roughly one seat's wait. An organization that would
 * rather spend less can narrow it, at the cost of the diversity the judge
 * chooses between.
 */
export function councilSizeOf(configured: number | null | undefined): number {
  if (configured === null || configured === undefined) return COUNCIL_SIZE_DEFAULT;
  if (!Number.isFinite(configured)) return COUNCIL_SIZE_DEFAULT;
  return Math.min(COUNCIL_SIZE_MAX, Math.max(COUNCIL_SIZE_MIN, Math.trunc(configured)));
}

/** Every enabled playbook of the organization, as the catalogue the skills step picks from. */
async function skillCatalogue(organizationId: string): Promise<SkillCard[]> {
  const rows = await prisma.organizationSkill.findMany({
    where: { organizationId, enabled: true },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, description: true, instructions: true, autoApply: true },
  });
  return rows.map(toSkillCard);
}

/**
 * Everything the pipeline needs to run one organization's campaign: the AI
 * runtime (keys never leave the server), tenant-scoped research and plugin
 * tools, and the Prisma-backed ports.
 *
 * Passing `runId` also honours the model the person pinned for the post. The
 * playbook catalogue always rides along; which playbooks apply is decided per
 * run by the skills step and read from the run snapshot.
 */
export async function buildPipelineContext(organizationId: string, runId?: string): Promise<PipelineContext> {
  const [ai, settings, researchTools, plugins, recentTexts, preferredModel, skills] = await Promise.all([
    aiRuntime(organizationId),
    prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { agentAllowedModels: true, agentCouncilSize: true },
    }),
    buildOrgResearchTools(organizationId),
    pluginTools(organizationId),
    recentPublishedTexts(organizationId),
    preferredModelOf(organizationId, runId),
    skillCatalogue(organizationId),
  ]);
  // One picked model wins over the organization allow-list; otherwise the
  // allow-list (or nothing, meaning automatic routing) applies.
  const allowedModels = preferredModel ? [preferredModel] : parseAllowedModels(settings?.agentAllowedModels);
  return {
    executor: ai.executor,
    router: ai.router,
    routing: async (capability, pref) => {
      const ctx = await ai.routing(capability, pref);
      return { ...ctx, requiredCapability: capability };
    },
    availableProviders: ai.available,
    allowedModels,
    skills,
    deadModels: new Set<string>(),
    /**
     * A model that reports itself retired, or that cannot serve chat
     * completions, is taken out of the catalogue rather than rediscovered on
     * every run. Only the row is deactivated: Super Admin can turn it back on.
     */
    retireModel: async (provider, model, reason) => {
      const { count } = await prisma.aIProviderConfig.updateMany({
        where: { provider, model, active: true },
        data: { active: false },
      });
      if (count > 0) logger.warn("model retired from the catalogue", { provider, model, reason: reason.slice(0, 160) });
    },
    modelsInUse: new Set<string>(),
    councilSize: councilSizeOf(settings?.agentCouncilSize),
    researchTools: [...researchTools, ...plugins],
    store: createPrismaRunStore(),
    budget: createPrismaBudget(),
    health: createPrismaProviderHealth(),
    live: { partial: (runId, message) => publishRun(runId, { type: "partial", ...message }) },
    recentTexts,
  };
}
