import { json, parseBody, withOrg } from "@/lib/api";
import { createPlan, listPlans, planInput } from "@/lib/agent/plan";
import { enforceAiRateLimit } from "@/lib/rate-limit";

export const GET = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => json({ plans: await listPlans(ctx.organization.id) }));

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const input = await parseBody(req, planInput);
    await enforceAiRateLimit(ctx, "plan");
    const plan = await createPlan(ctx, input);
    return json({ plan }, { status: 201 });
  });
