import { z } from "zod";
import { AI_PROVIDERS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { enforceAiRateLimit } from "@/lib/rate-limit";
import { brandContext } from "@/lib/services/brand";
import { attachedSkillInstructions, skillIdsInput } from "@/lib/skills";

const input = z.object({
  text: z.string().min(1).max(20_000),
  operation: z.enum(["REWRITE", "SHORTEN", "EXPAND", "TRANSLATE"]),
  instruction: z.string().max(1000).optional(),
  targetLanguage: z.string().max(40).optional(),
  maxLength: z.number().int().positive().optional(),
  brandId: z.string().optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
  model: z.string().max(100).optional(),
  skillIds: skillIdsInput,
});

export const POST = (req: Request) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const body = await parseBody(req, input);
    await enforceAiRateLimit(ctx);
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const [brand, instructions] = await Promise.all([
      brandContext(ctx.organization.id, body.brandId),
      attachedSkillInstructions(ctx.organization.id, body.skillIds),
    ]);
    const routing = await ai.routing("text", { provider: body.provider, model: body.model });
    const { skillIds: _skillIds, ...rest } = body;
    const text = await ai.ops.transform(routing, { ...rest, brand, instructions });
    const decision = ai.router.route({ ...routing, requiredCapability: "text" });
    return json({ text, provider: decision.provider, model: decision.model });
  });
