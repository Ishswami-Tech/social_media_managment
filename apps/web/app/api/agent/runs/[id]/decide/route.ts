import { json, parseBody, withOrg } from "@/lib/api";
import { decideAccounts, decideInput } from "@/lib/agent/runs";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:approve", async (ctx) => {
    const input = await parseBody(req, decideInput);
    return json({ run: await decideAccounts(ctx, (await params).id, input) });
  });
