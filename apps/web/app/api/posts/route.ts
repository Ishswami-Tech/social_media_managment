import { z } from "zod";
import { POST_STATUSES } from "@platform/types";
import { json, paginationSchema, parseBody, parseQuery, withOrg } from "@/lib/api";
import { createPost, createPostInput, listPosts } from "@/lib/services/posts";

const listQuery = paginationSchema.extend({
  status: z.enum(POST_STATUSES).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  mine: z.coerce.boolean().optional(),
});

export const GET = (req: Request) =>
  withOrg(req, "accounts:view", async (ctx) => {
    const q = parseQuery(req, listQuery);
    const result = await listPosts(ctx, {
      ...q,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      mine: q.mine || (!ctx.can("content:edit_any") && !ctx.can("content:approve")) ? true : undefined,
    });
    return json(result);
  });

export const POST = (req: Request) =>
  withOrg(req, "content:create", async (ctx) => {
    const input = await parseBody(req, createPostInput);
    const post = await createPost(ctx, input);
    return json({ post }, { status: 201 });
  });
