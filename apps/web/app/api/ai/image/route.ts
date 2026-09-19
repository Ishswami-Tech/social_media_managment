import { z } from "zod";
import { AI_PROVIDERS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiRuntime } from "@/lib/ai";
import { mediaUrl, storeGeneratedImage } from "@/lib/services/media";

const input = z.object({
  prompt: z.string().min(3).max(4000),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024", "1792x1024", "1024x1792"]).default("1024x1024"),
  n: z.number().int().min(1).max(4).default(1),
  provider: z.enum(AI_PROVIDERS).optional(),
  model: z.string().max(100).optional(),
});

export const POST = (req: Request) =>
  withOrg(req, "ai:image", async (ctx) => {
    const body = await parseBody(req, input);
    const ai = await aiRuntime(ctx.organization.id, ctx.user.id);
    const res = await ai.image({
      prompt: body.prompt,
      size: body.size,
      n: body.n,
      user: { provider: body.provider, model: body.model },
    });
    const assets = [];
    for (const img of res.images) {
      const bytes = img.base64
        ? Buffer.from(img.base64, "base64")
        : Buffer.from(await (await fetch(img.url!)).arrayBuffer());
      const asset = await storeGeneratedImage(ctx, bytes, img.mimeType, body.prompt);
      assets.push({ ...asset, url: await mediaUrl(asset) });
    }
    return json({ assets, provider: res.provider, model: res.model }, { status: 201 });
  });
