import { z } from "zod";
import { json, notFound, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { disconnectAccount } from "@/lib/services/oauth";

type Params = { params: Promise<{ id: string }> };

export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "accounts:connect", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, z.object({ requireApproval: z.boolean().nullable() }));
    const acct = await prisma.socialAccount.findFirst({ where: { id, organizationId: ctx.organization.id } });
    if (!acct) throw notFound("Account");
    const updated = await prisma.socialAccount.update({
      where: { id },
      data: { requireApproval: input.requireApproval },
    });
    await audit(ctx, "account.update", "SocialAccount", id, { requireApproval: input.requireApproval }, req);
    return json({ account: updated });
  });

export const DELETE = (req: Request, { params }: Params) =>
  withOrg(req, "accounts:connect", async (ctx) => {
    const { id } = await params;
    await disconnectAccount(ctx, id);
    return json({ ok: true });
  });
