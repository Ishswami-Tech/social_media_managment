import { z } from "zod";
import { CONVERSATION_STATUSES } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { assertConversation } from "@/lib/services/whatsapp";

type Params = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: Params) =>
  withOrg(req, "whatsapp:view", async (ctx) => {
    const { id } = await params;
    await assertConversation(ctx, id);
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: true,
        assignee: { select: { id: true, name: true } },
        notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    return json({ conversation });
  });

export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "whatsapp:reply", async (ctx) => {
    const { id } = await params;
    await assertConversation(ctx, id);
    const input = await parseBody(
      req,
      z.object({
        status: z.enum(CONVERSATION_STATUSES).optional(),
        assigneeId: z.string().nullable().optional(),
        markRead: z.boolean().optional(),
      }),
    );
    if (input.assigneeId) {
      const member = await prisma.member.findUnique({
        where: { organizationId_userId: { organizationId: ctx.organization.id, userId: input.assigneeId } },
      });
      if (!member) return json({ error: "bad_request", message: "Assignee is not a member" }, { status: 400 });
    }
    const conversation = await prisma.conversation.update({
      where: { id },
      data: { status: input.status, assigneeId: input.assigneeId, ...(input.markRead ? { unreadCount: 0 } : {}) },
    });
    await audit(
      ctx,
      "conversation.update",
      "Conversation",
      id,
      { status: input.status, assigneeId: input.assigneeId },
      req,
    );
    return json({ conversation });
  });
