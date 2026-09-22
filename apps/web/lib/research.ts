import { runAgent, parseJsonOutput, type Tool } from "@platform/ai-core";
import type { Prisma } from "@platform/database";
import {
  BraveConnector,
  BriefSchema,
  CONNECTOR_IDS,
  GeminiSearchConnector,
  TavilyConnector,
  buildResearchTools,
  type Brief,
  type ConnectorId,
  type SearchConnector,
  type SearchConnectorId,
} from "@platform/research";
import { aiRuntime, discoverModels, resolveAuth, type SelectableModel } from "./ai";
import { keyring, prisma } from "./db";
import { pluginTools } from "./plugins";
import { resolveSkill } from "./skills";
import { getEnv } from "./env";
import { ApiError } from "./errors";
import { logger, errorInfo } from "./logger";
import { brandContext } from "./services/brand";
import type { OrgContext } from "./session";

export interface ConnectorStatus {
  id: SearchConnectorId;
  configured: boolean;
  source: "organization" | "platform" | null;
}

/**
 * Which search connectors are usable for this organization (BYO key wins over
 * the platform key). Gemini search needs no key of its own: it is available
 * whenever a Gemini model can be reached for the organization.
 */
export async function connectorStatus(organizationId: string): Promise<ConnectorStatus[]> {
  const env = getEnv();
  const [own, gemini] = await Promise.all([
    prisma.organizationConnector.findMany({ where: { organizationId, active: true } }),
    geminiSearchSource(organizationId),
  ]);
  const platform: Record<ConnectorId, string | undefined> = {
    TAVILY: env.TAVILY_API_KEY,
    BRAVE: env.BRAVE_SEARCH_API_KEY,
  };
  const keyed = CONNECTOR_IDS.map((id): ConnectorStatus => {
    const o = own.find((c) => c.connector === id);
    return { id, configured: !!o || !!platform[id], source: o ? "organization" : platform[id] ? "platform" : null };
  });
  return [...keyed, { id: "GEMINI", configured: gemini !== null, source: gemini }];
}

/** Where the Gemini model used for search grounding comes from, or null when none is configured. */
async function geminiSearchSource(organizationId: string): Promise<"organization" | "platform" | null> {
  const model = await geminiSearchModel(organizationId);
  if (!model) return null;
  return model.source === "organization" ? "organization" : "platform";
}

/**
 * The Gemini text model used for Google Search grounding: the cheapest "flash"
 * model the account exposes, discovered live rather than hard-coded.
 */
async function geminiSearchModel(organizationId: string): Promise<SelectableModel | undefined> {
  const models = (await discoverModels(organizationId)).filter(
    (m) => m.provider === "GOOGLE" && m.capabilities.includes("text") && !m.model.includes("image"),
  );
  return models.find((m) => /flash/i.test(m.model)) ?? models[0];
}

export async function resolveSearchConnector(organizationId: string): Promise<SearchConnector | undefined> {
  const env = getEnv();
  const own = await prisma.organizationConnector.findMany({ where: { organizationId, active: true } });
  const key = (id: ConnectorId, platform?: string) => {
    const o = own.find((c) => c.connector === id);
    return o ? keyring().decrypt(o.keyEncrypted, `connector:${organizationId}:${id}`) : platform;
  };
  const tavily = key("TAVILY", env.TAVILY_API_KEY);
  if (tavily) return new TavilyConnector(tavily);
  const brave = key("BRAVE", env.BRAVE_SEARCH_API_KEY);
  if (brave) return new BraveConnector(brave);
  return resolveGeminiSearch(organizationId);
}

async function resolveGeminiSearch(organizationId: string): Promise<SearchConnector | undefined> {
  const [model, { resolver }] = await Promise.all([geminiSearchModel(organizationId), resolveAuth(organizationId)]);
  if (!model) return undefined;
  const auth = await resolver("GOOGLE");
  if (!auth) return undefined;
  return new GeminiSearchConnector({ apiKey: auth.apiKey, baseUrl: auth.baseUrl, model: model.model });
}

export async function setConnectorKey(ctx: OrgContext, connector: ConnectorId, apiKey: string) {
  // Validate the key with a tiny query before storing it.
  const probe = connector === "TAVILY" ? new TavilyConnector(apiKey) : new BraveConnector(apiKey);
  try {
    await probe.search("test", { maxResults: 1 });
  } catch (e) {
    throw new ApiError(400, `Key rejected by ${connector}: ${(e as Error).message}`, "invalid_key");
  }
  return prisma.organizationConnector.upsert({
    where: { organizationId_connector: { organizationId: ctx.organization.id, connector } },
    create: {
      organizationId: ctx.organization.id,
      connector,
      keyEncrypted: keyring().encrypt(apiKey, `connector:${ctx.organization.id}:${connector}`),
    },
    update: { active: true, keyEncrypted: keyring().encrypt(apiKey, `connector:${ctx.organization.id}:${connector}`) },
    select: { id: true, connector: true, active: true },
  });
}

/**
 * Tenant-scoped research tools (web search, URL/feed reading, brand knowledge,
 * recent post performance). Shared by research skills and the Agent Council.
 * Pass `search` explicitly to reuse a connector already resolved by the caller.
 */
export async function buildOrgResearchTools(
  organizationId: string,
  opts: { search?: SearchConnector } = {},
): Promise<Tool[]> {
  const search = "search" in opts ? opts.search : await resolveSearchConnector(organizationId);
  return buildResearchTools({
    search,
    brandKnowledge: async (q) => {
      const terms = q
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3)
        .slice(0, 8);
      const rows = await prisma.brandKnowledge.findMany({
        where: {
          brand: { organizationId },
          ...(terms.length
            ? { OR: terms.map((t) => ({ content: { contains: t, mode: "insensitive" as const } })) }
            : {}),
        },
        take: 6,
        select: { title: true, content: true },
      });
      return rows.map((r) => ({ title: r.title ?? undefined, content: r.content.slice(0, 1200) }));
    },
    recentPosts: async (limit) => {
      const rows = await prisma.postVariant.findMany({
        where: { post: { organizationId }, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: limit,
        include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
      });
      return rows.map((v) => ({
        platform: v.platform,
        text: v.text.slice(0, 400),
        publishedAt: v.publishedAt?.toISOString(),
        metrics: (v.snapshots[0]?.metrics as Record<string, number> | undefined) ?? undefined,
      }));
    },
  });
}

export interface RunSkillInput {
  skillId: string;
  input: string;
  platforms: string[];
  brandId?: string;
  provider?: "OPENAI" | "ANTHROPIC" | "GOOGLE";
  model?: string;
}

/**
 * Run a research skill for the organization: builds the tenant-scoped tool
 * set, runs the agent, validates the brief and stores it for reuse.
 */
export async function runResearchSkill(ctx: OrgContext, input: RunSkillInput) {
  const skill = await resolveSkill(ctx.organization.id, input.skillId);
  if (!skill) throw new ApiError(404, "Unknown skill", "not_found");
  const organizationId = ctx.organization.id;
  const [search, brand, ai] = await Promise.all([
    resolveSearchConnector(organizationId),
    brandContext(organizationId, input.brandId, input.input),
    aiRuntime(organizationId, ctx.user.id),
  ]);
  if (skill.needsSearch && !search) {
    throw new ApiError(
      409,
      "This skill needs a web search connector. Add a Tavily or Brave key under Settings → Research connectors.",
      "connector_missing",
    );
  }
  const allTools = (await buildOrgResearchTools(organizationId, { search }))
    .filter((t) => skill.tools.includes(t.definition.name as (typeof skill.tools)[number]))
    // Organization plugins (MCP servers, HTTP endpoints) are offered to every skill; the model decides when to call them.
    .concat(await pluginTools(organizationId));

  const routing = await ai.routing("json", { provider: input.provider, model: input.model });
  const started = Date.now();
  const result = await runAgent(ai.executor, routing, {
    system: skill.system({ brand: brand?.name, platforms: input.platforms }),
    user: skill.user(input.input, input.platforms),
    tools: allTools,
    maxSteps: skill.maxSteps,
    json: true,
    operation: "REPURPOSE",
  });
  let brief: Brief;
  try {
    brief = parseJsonOutput(BriefSchema, result.text);
  } catch (e) {
    logger.warn("research brief failed validation; storing raw text", { skill: skill.id, ...errorInfo(e) });
    brief = {
      title: input.input.slice(0, 120),
      summary: result.text,
      keyPoints: [],
      angles: [],
      postIdeas: [],
      sources: [],
      caveats: ["The model did not return a structured brief; this is its raw answer."],
    };
  }
  const row = await prisma.researchBrief.create({
    data: {
      organizationId,
      createdById: ctx.user.id,
      skill: skill.id,
      input: input.input,
      platforms: input.platforms,
      title: brief.title,
      summary: brief.summary,
      brief: brief as unknown as Prisma.InputJsonObject,
      trace: result.trace.map((t) => ({
        step: t.step,
        tool: t.call.name,
        args: t.call.arguments,
        durationMs: t.durationMs,
        error: t.error ?? null,
      })) as unknown as Prisma.InputJsonArray,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  });
  logger.info("research skill completed", {
    skill: skill.id,
    steps: result.steps,
    tools: result.trace.length,
    durationMs: Date.now() - started,
  });
  return {
    id: row.id,
    brief,
    trace: row.trace,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    steps: result.steps,
  };
}
