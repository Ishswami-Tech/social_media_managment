import { json, parseBody, withOrg } from "@/lib/api";
import { deletePlan, planUpdateInput, updatePlan } from "@/lib/agent/plan";

type Params = { params: Promise<{ id: string }> };

/** Rename a plan, or archive and restore it. */
export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const input = await parseBody(req, planUpdateInput);
    return json({ plan: await updatePlan(ctx, (await params).id, input) });
  });

/** Removes the plan. Campaigns already started from it keep running. */
export const DELETE = (req: Request, { params }: Params) =>
  withOrg(req, "ai:generate", async (ctx) => {
    await deletePlan(ctx, (await params).id);
    return json({ ok: true });
  });
