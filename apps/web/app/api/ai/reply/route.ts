import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { enforceAiRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { brandContext } from "@/lib/services/brand";
import { assertConversation } from "@/lib/services/whatsapp";

export const POST = (req: Request) =>
  withOrg(req, "whatsapp:reply", async (ctx) => {
    const { conversationId } = await parseBody(req, z.object({ conversationId: z.string() }));
    await assertConversation(ctx, conversationId);
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    await enforceAiRateLimit(ctx);
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const brand = await brandContext(
      ctx.organization.id,
      undefined,
      messages[0] ? String((messages[0].content as { text?: string }).text ?? "") : undefined,
    );
    const suggestion = await ai.ops.suggestReply(await ai.routing("json"), {
      conversation: messages.reverse().map((m) => ({
        direction: m.direction,
        text: String(
          (m.content as { text?: string; caption?: string }).text ??
            (m.content as { caption?: string }).caption ??
            `[${m.type.toLowerCase()}]`,
        ),
      })),
      brand,
    });
    return json({
      suggestion,
      requiresHumanApproval: ctx.settings.whatsappRequireHumanApproval || suggestion.needsHuman,
    });
  });
