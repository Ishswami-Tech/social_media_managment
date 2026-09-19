import { json, withOrg } from "@/lib/api";
import { organizationSummary } from "@/lib/services/analytics";

export const GET = (req: Request) =>
  withOrg(req, "analytics:view", async (ctx) => json(await organizationSummary(ctx.organization.id)));
