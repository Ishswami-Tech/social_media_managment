import { json, notFound, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const { id } = await params;
    const brief = await prisma.researchBrief.findFirst({ where: { id, organizationId: ctx.organization.id } });
    if (!brief) throw notFound("Research brief");
    return json({ brief });
  });

export const DELETE = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const { id } = await params;
    const { count } = await prisma.researchBrief.deleteMany({ where: { id, organizationId: ctx.organization.id } });
    if (!count) throw notFound("Research brief");
    return json({ ok: true });
  });
