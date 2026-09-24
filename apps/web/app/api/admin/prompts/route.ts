import { json, withSuperAdmin } from "@/lib/api";
import { labPrompts, labRuns } from "@/lib/agent/lab";

/** Prompts the lab can run and recent campaigns to borrow context from. */
export const GET = (req: Request) =>
  withSuperAdmin(req, async () => json({ prompts: labPrompts(), runs: await labRuns() }));
