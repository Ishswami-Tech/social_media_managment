import { json, parseBody, withOrg } from "@/lib/api";
import { deletePost, getPost, updatePost, updatePostInput } from "@/lib/services/posts";

type Params = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: Params) =>
  withOrg(req, "accounts:view", async (ctx) => json({ post: await getPost(ctx, (await params).id) }));

export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "content:create", async (ctx) => {
    const input = await parseBody(req, updatePostInput);
    return json({ post: await updatePost(ctx, (await params).id, input) });
  });

export const DELETE = (req: Request, { params }: Params) =>
  withOrg(req, "content:create", async (ctx) => {
    await deletePost(ctx, (await params).id);
    return json({ ok: true });
  });
