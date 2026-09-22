import { z } from "zod";
import { badRequest, json, notFound, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { disconnectAccount } from "@/lib/services/oauth";

type Params = { params: Promise<{ id: string }> };

const accountPatchInput = z.object({
  /** null = inherit the organization approval default. */
  requireApproval: z.boolean().nullable().optional(),
  /** Campaigns may publish to this account without a human when the organization mode is AUTOMATIC. */
  agentAutoPublish: z.boolean().optional(),
});

export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "accounts:connect", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, accountPatchInput);
    const acct = await prisma.socialAccount.findFirst({ where: { id, organizationId: ctx.organization.id } });
    if (!acct) throw notFound("Account");
    const data = {
      ...(input.requireApproval !== undefined ? { requireApproval: input.requireApproval } : {}),
      ...(input.agentAutoPublish !== undefined ? { agentAutoPublish: input.agentAutoPublish } : {}),
    };
    if (Object.keys(data).length === 0) throw badRequest("Nothing to update");
    const updated = await prisma.socialAccount.update({ where: { id }, data });
    await audit(ctx, "account.update", "SocialAccount", id, data, req);
    return json({ account: updated });
  });

export const DELETE = (req: Request, { params }: Params) =>
  withOrg(req, "accounts:connect", async (ctx) => {
    const { id } = await params;
    await disconnectAccount(ctx, id);
    return json({ ok: true });
  });
