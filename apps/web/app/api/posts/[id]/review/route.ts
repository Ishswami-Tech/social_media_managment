import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { reviewPost } from "@/lib/services/posts";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:approve", async (ctx) => {
    const input = await parseBody(
      req,
      z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().max(2000).optional() }),
    );
    return json({ post: await reviewPost(ctx, (await params).id, input.decision, input.comment) });
  });
