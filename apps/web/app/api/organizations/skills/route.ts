import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import {
  createSkill,
  createSkillInput,
  deleteSkill,
  importSkillsFromUrl,
  importSkillsInput,
  listOrganizationSkills,
  setSkillAutoApply,
  setSkillEnabled,
} from "@/lib/skills";

export const GET = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => json({ skills: await listOrganizationSkills(ctx.organization.id) }));

/** Import from a GitHub URL (`{ url }`) or create one skill from markdown (`{ name, markdown, ... }`). */
export const POST = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const body = await parseBody(req, z.union([importSkillsInput, createSkillInput]));
    if ("url" in body) return json({ skills: await importSkillsFromUrl(ctx, body.url) }, { status: 201 });
    return json({ skill: await createSkill(ctx, body) }, { status: 201 });
  });

export const PATCH = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id, enabled, autoApply } = await parseBody(
      req,
      z.object({ id: z.string().min(1), enabled: z.boolean().optional(), autoApply: z.boolean().optional() }),
    );
    if (enabled !== undefined) return json({ skill: await setSkillEnabled(ctx, id, enabled) });
    if (autoApply !== undefined) return json({ skill: await setSkillAutoApply(ctx, id, autoApply) });
    return json({ error: "bad_request", message: "Nothing to update" }, { status: 400 });
  });

export const DELETE = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id } = await parseBody(req, z.object({ id: z.string().min(1) }));
    await deleteSkill(ctx, id);
    return json({ ok: true });
  });
