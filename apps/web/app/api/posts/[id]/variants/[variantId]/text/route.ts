import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { editPublishedVariant } from "@/lib/services/posts";

type Params = { params: Promise<{ id: string; variantId: string }> };

/** Change the text of a live post in place on the platform. */
export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "content:publish", async (ctx) => {
    const { id, variantId } = await params;
    const { text } = await parseBody(req, z.object({ text: z.string().trim().min(1).max(65_000) }));
    return json({ variant: await editPublishedVariant(ctx, id, variantId, text) });
  });
