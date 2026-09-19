import { json, withOrg } from "@/lib/api";
import { submitForReview } from "@/lib/services/posts";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:create", async (ctx) => json({ post: await submitForReview(ctx, (await params).id) }));
