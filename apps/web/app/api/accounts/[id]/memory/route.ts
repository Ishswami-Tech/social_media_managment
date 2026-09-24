import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { forgetPreference, memoryInput, saveAccountMemory } from "@/lib/services/memory";

type Params = { params: Promise<{ id: string }> };

const forgetInput = z.object({ forgetPreference: z.number().int().min(0) });

/** Replace the editable memory of one account (identity, audience, voice, content). */
export const PUT = (req: Request, { params }: Params) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, memoryInput);
    await saveAccountMemory(ctx, id, input);
    return json({ ok: true });
  });

/** Forget one learned preference by its position. */
export const PATCH = (req: Request, { params }: Params) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id } = await params;
    const input = await parseBody(req, forgetInput);
    await forgetPreference(ctx, id, input.forgetPreference);
    return json({ ok: true });
  });
