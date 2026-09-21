import { json, withOrg } from "@/lib/api";
import { unpublishPost } from "@/lib/services/posts";

/** Removes a published post from its platforms and records the removal in the post history. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:publish", async (ctx) => json(await unpublishPost(ctx, (await params).id)));
