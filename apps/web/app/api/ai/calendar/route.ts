import { z } from "zod";
import { PLATFORMS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { brandContext } from "@/lib/services/brand";

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const body = await parseBody(
      req,
      z.object({
        theme: z.string().min(3).max(2000),
        platforms: z.array(z.enum(PLATFORMS)).min(1),
        startDate: z.string().date(),
        days: z.number().int().min(7).max(90).default(30),
        postsPerWeek: z.number().int().min(1).max(21).default(3),
        brandId: z.string().optional(),
      }),
    );
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const brand = await brandContext(ctx.organization.id, body.brandId);
    return json(await ai.ops.calendar(await ai.routing("json"), { ...body, brand }));
  });
