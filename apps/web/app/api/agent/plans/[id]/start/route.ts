import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { startPlanItem } from "@/lib/agent/plan";

type Params = { params: Promise<{ id: string }> };

/** Start one plan item as a campaign for every connected account on its platform. */
export const POST = (req: Request, { params }: Params) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const { id } = await params;
    const { index } = await parseBody(req, z.object({ index: z.number().int().min(0) }));
    const run = await startPlanItem(ctx, id, index);
    return json({ run: { id: run.id, status: run.status } }, { status: 201 });
  });
