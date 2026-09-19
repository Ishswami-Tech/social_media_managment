import { z } from "zod";
import { AI_PROVIDERS, PLATFORMS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { brandContext, targetsFor } from "@/lib/services/brand";

const input = z.object({
  idea: z.string().min(3).max(20_000),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(8),
  brandId: z.string().optional(),
  extraInstructions: z.string().max(2000).optional(),
  count: z.number().int().min(1).max(3).default(1),
  provider: z.enum(AI_PROVIDERS).optional(),
  model: z.string().max(100).optional(),
});

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const body = await parseBody(req, input);
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const brand = await brandContext(ctx.organization.id, body.brandId, body.idea);
    const routing = await ai.routing("json", { provider: body.provider, model: body.model });
    const result = await ai.ops.generateVariants(routing, {
      idea: body.idea,
      targets: targetsFor(body.platforms),
      brand,
      extraInstructions: body.extraInstructions,
      count: body.count,
    });
    return json(result);
  });
