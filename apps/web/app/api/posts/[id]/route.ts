import { ApiError, json, parseBody, withOrg } from "@/lib/api";
import { deletePost, getPost, updatePost, updatePostInput } from "@/lib/services/posts";

type Params = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: Params) =>
  withOrg(req, "accounts:view", async (ctx) => json({ post: await getPost(ctx, (await params).id) }));

export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "content:create", async (ctx) => {
    const input = await parseBody(req, updatePostInput);
    return json({ post: await updatePost(ctx, (await params).id, input) });
  });

/** `?removeFromPlatforms=1` takes a live post down first; that half needs publish rights. */
export const DELETE = (req: Request, { params }: Params) =>
  withOrg(req, "content:create", async (ctx) => {
    const removeFromPlatforms = new URL(req.url).searchParams.get("removeFromPlatforms") === "1";
    if (removeFromPlatforms && !ctx.can("content:publish"))
      throw new ApiError(403, "Publish rights are needed to take a live post down", "forbidden");
    return json({ ok: true, ...(await deletePost(ctx, (await params).id, { removeFromPlatforms })) });
  });
