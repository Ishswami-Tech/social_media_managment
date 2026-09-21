import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { deletePlugin, listOrganizationPlugins, pluginInput, savePlugin, setPluginEnabled } from "@/lib/plugins";

export const GET = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => json({ plugins: await listOrganizationPlugins(ctx.organization.id) }));

/** Create a plugin; the connection is tested (MCP `tools/list`) and the outcome stored. */
export const POST = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const body = await parseBody(req, pluginInput);
    return json({ plugin: await savePlugin(ctx, body) }, { status: 201 });
  });

export const PUT = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id, ...body } = await parseBody(req, pluginInput.extend({ id: z.string().min(1) }));
    return json({ plugin: await savePlugin(ctx, body, id) });
  });

export const PATCH = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id, enabled } = await parseBody(req, z.object({ id: z.string().min(1), enabled: z.boolean() }));
    return json({ plugin: await setPluginEnabled(ctx, id, enabled) });
  });

export const DELETE = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id } = await parseBody(req, z.object({ id: z.string().min(1) }));
    await deletePlugin(ctx, id);
    return json({ ok: true });
  });
