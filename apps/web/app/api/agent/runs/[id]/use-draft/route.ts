import { json, parseBody, withOrg } from "@/lib/api";
import { useDraftInput, useDraftInstead } from "@/lib/agent/editing";
import { enforceAiRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string }> };

/** Override the judge with another written draft and run the platform pass on it. */
export const POST = (req: Request, { params }: Params) =>
  withOrg(req, "content:approve", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, useDraftInput);
    await enforceAiRateLimit(ctx, "use-draft");
    return json({ account: await useDraftInstead(ctx, id, input) });
  });
