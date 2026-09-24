import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { addStory, deleteStory, listStories, storyInput } from "@/lib/services/memory";

export const GET = (req: Request) =>
  withOrg(req, "accounts:view", async (ctx) => json({ stories: await listStories(ctx.organization.id) }));

export const POST = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const input = await parseBody(req, storyInput);
    return json({ story: await addStory(ctx, input) }, { status: 201 });
  });

export const DELETE = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id } = await parseBody(req, z.object({ id: z.string().min(1) }));
    await deleteStory(ctx, id);
    return json({ ok: true });
  });
