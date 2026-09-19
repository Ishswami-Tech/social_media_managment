import { z } from "zod";
import { MEDIA_KINDS } from "@platform/types";
import { json, paginationSchema, parseBody, parseQuery, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { mediaUrl, requestUpload, requestUploadInput } from "@/lib/services/media";

export const GET = (req: Request) =>
  withOrg(req, "accounts:view", async (ctx) => {
    const q = parseQuery(req, paginationSchema.extend({ kind: z.enum(MEDIA_KINDS).optional() }));
    const where = {
      organizationId: ctx.organization.id,
      status: { not: "PENDING_UPLOAD" as const },
      ...(q.kind ? { kind: q.kind } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.mediaAsset.count({ where }),
    ]);
    const withUrls = await Promise.all(
      items.map(async (a) => ({ ...a, url: await mediaUrl(a), thumbnailUrl: await mediaUrl(a, "thumbnail") })),
    );
    return json({ items: withUrls, total, page: q.page, pageSize: q.pageSize });
  });

export const POST = (req: Request) =>
  withOrg(req, "media:upload", async (ctx) => {
    const input = await parseBody(req, requestUploadInput);
    return json(await requestUpload(ctx, input), { status: 201 });
  });
