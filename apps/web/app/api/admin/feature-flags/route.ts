import { z } from "zod";
import { json, parseBody, withSuperAdmin } from "@/lib/api";
import { auditPlatform } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withSuperAdmin(req, async () => json({ flags: await prisma.featureFlag.findMany({ orderBy: { key: "asc" } }) }));

export const PUT = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const input = await parseBody(
      req,
      z.object({
        key: z.string().min(1).max(60),
        description: z.string().max(300).optional(),
        enabled: z.boolean(),
        organizationIds: z.array(z.string()).default([]),
      }),
    );
    const flag = await prisma.featureFlag.upsert({ where: { key: input.key }, create: input, update: input });
    await auditPlatform(session.user.id, "admin.feature_flag.update", "FeatureFlag", flag.key, {
      enabled: flag.enabled,
    });
    return json({ flag });
  });
