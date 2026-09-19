import { z } from "zod";
import { json, paginationSchema, parseQuery, withSuperAdmin } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withSuperAdmin(req, async () => {
    const q = parseQuery(
      req,
      paginationSchema.extend({
        search: z.string().max(100).optional(),
        status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
      }),
    );
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { slug: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: { plan: true, _count: { select: { members: true, socialAccounts: true, posts: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.organization.count({ where }),
    ]);
    return json({ items, total });
  });
