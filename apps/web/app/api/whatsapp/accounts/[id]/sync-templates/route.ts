import { json, notFound, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { syncTemplates } from "@/lib/services/whatsapp";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "whatsapp:manage", async (ctx) => {
    const { id } = await params;
    const acct = await prisma.whatsAppAccount.findFirst({ where: { id, organizationId: ctx.organization.id } });
    if (!acct) throw notFound("WhatsApp account");
    return json({ synced: await syncTemplates(id) });
  });
