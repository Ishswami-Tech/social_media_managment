import { json, parseBody, withSuperAdmin } from "@/lib/api";
import { labInput, runPromptLab } from "@/lib/agent/lab";

/** Run one stage prompt from a real campaign against up to four models and compare. */
export const POST = (req: Request) =>
  withSuperAdmin(req, async () => {
    const input = await parseBody(req, labInput);
    return json({ result: await runPromptLab(input) });
  });
