import { z } from "zod";
import { PLATFORMS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const body = await parseBody(
      req,
      z.object({
        text: z.string().min(1).max(20_000),
        platform: z.enum(PLATFORMS),
        count: z.number().int().min(1).max(30).default(10),
      }),
    );
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const [hashtags, hooks] = await Promise.all([
      ai.ops.hashtags(await ai.routing("json"), body),
      ai.ops.hooksAndCtas(await ai.routing("json"), { idea: body.text, platform: body.platform }),
    ]);
    return json({ hashtags, ...hooks });
  });
