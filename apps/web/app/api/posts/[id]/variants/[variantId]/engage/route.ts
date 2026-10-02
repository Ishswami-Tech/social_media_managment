import { json, parseBody, withOrg } from "@/lib/api";
import { engageInput, engageWithVariant } from "@/lib/services/posts";

type Params = { params: Promise<{ id: string; variantId: string }> };

/**
 * React to, comment on or reshare a live post as the account that owns it.
 *
 * Guarded by content:publish rather than content:edit: each of these puts
 * something on a real platform under the organization's name.
 */
export const POST = (req: Request, { params }: Params) =>
  withOrg(req, "content:publish", async (ctx) => {
    const { id, variantId } = await params;
    const input = await parseBody(req, engageInput);
    return json({ result: await engageWithVariant(ctx, id, variantId, input) });
  });
