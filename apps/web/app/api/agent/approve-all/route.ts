import { json, parseBody, withOrg } from "@/lib/api";
import { approveAll, approveAllInput } from "@/lib/agent/runs";

/** Approves every pending account on the listed campaigns. Each campaign follows the single-approval rules. */
export const POST = (req: Request) =>
  withOrg(req, "content:approve", async (ctx) => {
    const input = await parseBody(req, approveAllInput);
    return json(await approveAll(ctx, input));
  });
