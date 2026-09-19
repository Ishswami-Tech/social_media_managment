import { z } from "zod";
import { PLATFORMS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { brandContext } from "@/lib/services/brand";

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const body = await parseBody(
      req,
      z.object({ text: z.string().min(1).max(20_000), platform: z.enum(PLATFORMS), brandId: z.string().optional() }),
    );
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const brand = await brandContext(ctx.organization.id, body.brandId);
    return json(await ai.ops.qualityCheck(await ai.routing("json"), { ...body, brand }));
  });
