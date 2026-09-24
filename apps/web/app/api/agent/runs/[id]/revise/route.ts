import { json, parseBody, withOrg } from "@/lib/api";
import { reviseInput, reviseWithAi } from "@/lib/agent/editing";
import { enforceAiRateLimit } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string }> };

/** Ask the editor agent for a change to one account's text; the instruction is learned as a preference. */
export const POST = (req: Request, { params }: Params) =>
  withOrg(req, "content:approve", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, reviseInput);
    await enforceAiRateLimit(ctx, "revise");
    return json({ account: await reviseWithAi(ctx, id, input) });
  });
