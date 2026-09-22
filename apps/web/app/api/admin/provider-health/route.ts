import { json, withSuperAdmin } from "@/lib/api";
import { providerHealthSummary } from "@/lib/agent/provider-health";

export const GET = (req: Request) => withSuperAdmin(req, async () => json({ providers: await providerHealthSummary() }));
