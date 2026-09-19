import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertConversation } from "@/lib/services/whatsapp";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "whatsapp:reply", async (ctx) => {
    const { id } = await params;
    await assertConversation(ctx, id);
    const { body } = await parseBody(req, z.object({ body: z.string().min(1).max(4000) }));
    const note = await prisma.conversationNote.create({ data: { conversationId: id, authorId: ctx.user.id, body } });
    return json({ note }, { status: 201 });
  });
