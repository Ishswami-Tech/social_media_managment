import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { schedulePost } from "@/lib/services/posts";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:publish", async (ctx) => {
    const input = await parseBody(
      req,
      z.object({ scheduledAt: z.string().datetime({ offset: true }), timezone: z.string().max(64).optional() }),
    );
    return json({ post: await schedulePost(ctx, (await params).id, input.scheduledAt, input.timezone) });
  });
