import { z } from "zod";
import { json, parseQuery, withSuperAdmin } from "@/lib/api";
import { labModels } from "@/lib/agent/lab";

/** Models the chosen campaign's organization can reach. */
export const GET = (req: Request) =>
  withSuperAdmin(req, async () => {
    const { runId } = parseQuery(req, z.object({ runId: z.string().min(1) }));
    return json({ models: await labModels(runId) });
  });
