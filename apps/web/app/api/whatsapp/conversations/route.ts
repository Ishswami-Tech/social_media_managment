import { z } from "zod";
import { CONVERSATION_STATUSES } from "@platform/types";
import { json, paginationSchema, parseQuery, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withOrg(req, "whatsapp:view", async (ctx) => {
    const q = parseQuery(
      req,
      paginationSchema.extend({
        status: z.enum(CONVERSATION_STATUSES).optional(),
        assigned: z.enum(["me", "unassigned"]).optional(),
        search: z.string().max(100).optional(),
      }),
    );
    const where = {
      organizationId: ctx.organization.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.assigned === "me" ? { assigneeId: ctx.user.id } : q.assigned === "unassigned" ? { assigneeId: null } : {}),
      ...(q.search
        ? {
            contact: {
              OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { phone: { contains: q.search } }],
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: true,
          assignee: { select: { id: true, name: true } },
          whatsappAccount: { select: { displayPhoneNumber: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.conversation.count({ where }),
    ]);
    return json({ items, total });
  });
