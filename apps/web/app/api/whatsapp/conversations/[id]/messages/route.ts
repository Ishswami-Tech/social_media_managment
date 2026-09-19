import { z } from "zod";
import { json, parseQuery, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertConversation } from "@/lib/services/whatsapp";

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "whatsapp:view", async (ctx) => {
    const { id } = await params;
    await assertConversation(ctx, id);
    const q = parseQuery(
      req,
      z.object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    );
    const messages = await prisma.message.findMany({
      where: { conversationId: id, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });
    return json({ messages: messages.reverse() });
  });
