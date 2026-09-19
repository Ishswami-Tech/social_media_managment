import { z } from "zod";
import { normalizePhone } from "@platform/whatsapp";
import { json, paginationSchema, parseBody, parseQuery, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withOrg(req, "whatsapp:view", async (ctx) => {
    const q = parseQuery(
      req,
      paginationSchema.extend({ search: z.string().max(100).optional(), tag: z.string().max(40).optional() }),
    );
    const where = {
      organizationId: ctx.organization.id,
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { phone: { contains: q.search } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);
    return json({ items, total });
  });

export const POST = (req: Request) =>
  withOrg(req, "whatsapp:reply", async (ctx) => {
    const input = await parseBody(
      req,
      z.object({
        phone: z.string().min(6).max(20),
        name: z.string().max(120).optional(),
        email: z.string().email().optional(),
        tags: z.array(z.string().max(40)).max(20).default([]),
      }),
    );
    const phone = normalizePhone(input.phone);
    const contact = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId: ctx.organization.id, phone } },
      create: { organizationId: ctx.organization.id, phone, name: input.name, email: input.email, tags: input.tags },
      update: { name: input.name, email: input.email, tags: input.tags },
    });
    return json({ contact }, { status: 201 });
  });
