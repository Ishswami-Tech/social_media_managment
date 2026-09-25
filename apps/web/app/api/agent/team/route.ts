import { json, withOrg } from "@/lib/api";
import { loadTeam } from "@/lib/agent/team";

export const dynamic = "force-dynamic";

/** The team right now: who is on duty, their recent numbers, and the latest activity across campaigns. */
export const GET = (req: Request) => withOrg(req, "accounts:view", async (ctx) => json(await loadTeam(ctx.organization.id)));
