import { json, parseBody, withOrg } from "@/lib/api";
import { saveDraftInput, saveDraftText } from "@/lib/agent/editing";

type Params = { params: Promise<{ id: string }> };

/** Save a manual edit of one account's text without approving. */
export const POST = (req: Request, { params }: Params) =>
  withOrg(req, "content:approve", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, saveDraftInput);
    return json({ account: await saveDraftText(ctx, id, input) });
  });
