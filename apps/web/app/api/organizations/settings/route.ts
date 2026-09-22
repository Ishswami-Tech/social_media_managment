import { z } from "zod";
import { CAPABILITIES } from "@platform/rbac";
import { AGENT_ASSURANCE_LEVELS, AGENT_PUBLISH_MODES, AI_PROVIDERS, ORG_ROLES } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const settingsInput = z.object({
  timezone: z.string().max(64).optional(),
  requireApproval: z.boolean().optional(),
  whatsappRequireHumanApproval: z.boolean().optional(),
  aiDefaultProvider: z.enum(AI_PROVIDERS).nullable().optional(),
  aiDefaultModel: z.string().max(100).nullable().optional(),
  aiImageProvider: z.enum(AI_PROVIDERS).nullable().optional(),
  aiImageModel: z.string().max(100).nullable().optional(),
  aiRetainPrompts: z.boolean().optional(),
  permissionOverrides: z.record(z.enum(ORG_ROLES), z.array(z.enum(CAPABILITIES))).optional(),
  // Agent Council (campaign automation)
  agentPublishMode: z.enum(AGENT_PUBLISH_MODES).optional(),
  agentAssurance: z.enum(AGENT_ASSURANCE_LEVELS).optional(),
  agentRunMaxCents: z.number().int().min(1).max(100_000).optional(),
  agentMonthlyBudgetCents: z.number().int().min(1).max(10_000_000).optional(),
  agentMaxActiveRuns: z.number().int().min(1).max(100).optional(),
  /** Allow-list of "PROVIDER::model" strings; an empty list means any model the organization can reach. */
  agentAllowedModels: z.array(z.string().min(1).max(200)).max(200).optional(),
});

export const GET = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: ctx.organization.id } });
    return json({ organization: ctx.organization, settings });
  });

export const PATCH = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const input = await parseBody(req, settingsInput);
    const settings = await prisma.organizationSettings.upsert({
      where: { organizationId: ctx.organization.id },
      create: {
        organizationId: ctx.organization.id,
        ...input,
        permissionOverrides: input.permissionOverrides ?? undefined,
      },
      update: { ...input, permissionOverrides: input.permissionOverrides ?? undefined },
    });
    await audit(
      ctx,
      "organization.settings.update",
      "OrganizationSettings",
      settings.id,
      { fields: Object.keys(input) },
      req,
    );
    return json({ settings });
  });
