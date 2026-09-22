import { z } from "zod";
import { AI_CAPABILITIES, AI_PROVIDERS } from "@platform/types";
import { json, parseBody, withSuperAdmin } from "@/lib/api";
import { auditPlatform } from "@/lib/audit";
import { prisma } from "@/lib/db";

/**
 * Pricing, default and priority overlay for a discovered model. Rows live in
 * AIProviderConfig; discovery decides which models exist, this decides how they
 * are routed and costed.
 */
const upsert = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
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
