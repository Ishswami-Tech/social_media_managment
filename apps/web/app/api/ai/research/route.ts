import { z } from "zod";
import { AI_PROVIDERS, PLATFORMS } from "@platform/types";
import { json, paginationSchema, parseBody, parseQuery, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { connectorStatus, runResearchSkill } from "@/lib/research";
import { listSkillSummaries } from "@/lib/skills";
import { enforceAiRateLimit } from "@/lib/rate-limit";

export const GET = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const q = parseQuery(req, paginationSchema);
    const [items, total, connectors, skills] = await Promise.all([
      prisma.researchBrief.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          skill: true,
          input: true,
          title: true,
          summary: true,
          platforms: true,
          createdAt: true,
          provider: true,
          model: true,
        },
      }),
      prisma.researchBrief.count({ where: { organizationId: ctx.organization.id } }),
      connectorStatus(ctx.organization.id),
      listSkillSummaries(ctx.organization.id),
    ]);
    return json({
      items,
      total,
      skills,
      connectors,
    });
  });

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    await enforceAiRateLimit(ctx, "research");
    const body = await parseBody(
      req,
      z.object({
        skillId: z.string().min(1),
        input: z.string().min(2).max(4000),
        platforms: z.array(z.enum(PLATFORMS)).min(1).default(["LINKEDIN"]),
        brandId: z.string().optional(),
        provider: z.enum(AI_PROVIDERS).optional(),
        model: z.string().max(100).optional(),
      }),
    );
    const result = await runResearchSkill(ctx, body);
    await audit(ctx, "ai.research.run", "ResearchBrief", result.id, { skill: body.skillId, steps: result.steps }, req);
    return json(result, { status: 201 });
  });
