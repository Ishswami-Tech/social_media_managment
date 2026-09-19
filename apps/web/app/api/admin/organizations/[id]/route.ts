import { z } from "zod";
import { json, notFound, parseBody, withSuperAdmin } from "@/lib/api";
import { auditPlatform } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const PATCH = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withSuperAdmin(req, async (session) => {
    const { id } = await params;
    const input = await parseBody(
      req,
      z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(), planSlug: z.string().optional() }),
    );
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) throw notFound("Organization");
    const plan = input.planSlug ? await prisma.plan.findUnique({ where: { slug: input.planSlug } }) : undefined;
    if (input.planSlug && !plan) throw notFound("Plan");
    const updated = await prisma.organization.update({
      where: { id },
      data: { status: input.status, planId: plan?.id },
    });
    await auditPlatform(
      session.user.id,
      "admin.organization.update",
      "Organization",
      id,
      { status: input.status, plan: input.planSlug },
      id,
    );
    return json({ organization: updated });
  });
