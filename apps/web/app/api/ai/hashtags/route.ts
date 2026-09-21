import { z } from "zod";
import { AI_PROVIDERS, PLATFORMS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { enforceAiRateLimit } from "@/lib/rate-limit";
import { attachedSkillInstructions, skillIdsInput } from "@/lib/skills";

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const body = await parseBody(
      req,
      z.object({
        text: z.string().min(1).max(20_000),
        platform: z.enum(PLATFORMS),
        count: z.number().int().min(1).max(30).default(10),
        provider: z.enum(AI_PROVIDERS).optional(),
        model: z.string().max(100).optional(),
        skillIds: skillIdsInput,
      }),
    );
    await enforceAiRateLimit(ctx);
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const instructions = await attachedSkillInstructions(ctx.organization.id, body.skillIds);
    const routing = await ai.routing("json", { provider: body.provider, model: body.model });
    const [hashtags, hooks] = await Promise.all([
      ai.ops.hashtags(routing, { ...body, instructions }),
      ai.ops.hooksAndCtas(routing, { idea: body.text, platform: body.platform, instructions }),
    ]);
    const decision = ai.router.route({ ...routing, requiredCapability: "json" });
    return json({ hashtags, ...hooks, provider: decision.provider, model: decision.model });
  });
