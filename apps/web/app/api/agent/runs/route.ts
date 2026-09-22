import { json, parseBody, parseQuery, withOrg } from "@/lib/api";
import { createRun, createRunInput, listRuns, listRunsQuery } from "@/lib/agent/runs";

export const GET = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const query = parseQuery(req, listRunsQuery);
    return json(await listRuns(ctx, query));
  });

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const input = await parseBody(req, createRunInput);
    const run = await createRun(ctx, input);
    return json({ run }, { status: 201 });
  });
