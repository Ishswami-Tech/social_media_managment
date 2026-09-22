import { json, withOrg } from "@/lib/api";
import { retryRun } from "@/lib/agent/runs";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "content:create", async (ctx) => json({ run: await retryRun(ctx, (await params).id) }));
