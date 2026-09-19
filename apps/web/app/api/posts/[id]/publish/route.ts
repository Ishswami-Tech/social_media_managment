import { json, withOrg } from "@/lib/api";
import { publishNow } from "@/lib/services/posts";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:publish", async (ctx) => json({ post: await publishNow(ctx, (await params).id) }));
