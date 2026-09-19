import { json, withSuperAdmin } from "@/lib/api";
import { platformSummary } from "@/lib/services/analytics";

export const GET = (req: Request) => withSuperAdmin(req, async () => json(await platformSummary()));
