import { json, withOrg } from "@/lib/api";
import { getRun } from "@/lib/agent/runs";

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "ai:generate", async (ctx) => json({ run: await getRun(ctx, (await params).id) }));
