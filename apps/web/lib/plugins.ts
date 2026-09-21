import { z } from "zod";
import { buildPluginTools, isPublicHttpUrl, McpClient, type PluginDefinition } from "@platform/research";
import type { Tool } from "@platform/ai-core";
import type { Prisma } from "@platform/database";
import { ApiError } from "./errors";
import { audit } from "./audit";
import { keyring, prisma } from "./db";
import { getEnv } from "./env";
import { errorInfo, logger } from "./logger";
import type { OrgContext } from "./session";

/**
 * Plugins (Settings → Plugins): external tools the model can call during skill
 * runs. Headers such as Authorization are encrypted at rest with the keyring.
 */

const aad = (organizationId: string, slug: string) => `plugin:${organizationId}:${slug}`;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "plugin";
}

export const pluginInput = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(""),
  kind: z.enum(["MCP", "HTTP"]),
  url: z.string().url().max(500),
  /** Header lines, e.g. "Authorization: Bearer …". Empty keeps the stored headers on update. */
  headers: z.record(z.string(), z.string()).optional(),
  method: z.enum(["GET", "POST"]).default("POST"),
  /** HTTP plugins: JSON schema describing the tool arguments. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type PluginInput = z.infer<typeof pluginInput>;

const pluginSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  kind: true,
  url: true,
  method: true,
  inputSchema: true,
  enabled: true,
  lastTestedAt: true,
  lastTestStatus: true,
  updatedAt: true,
} as const;

export async function listOrganizationPlugins(organizationId: string) {
  return prisma.organizationPlugin.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: pluginSelect });
}

async function definitionsFor(organizationId: string): Promise<PluginDefinition[]> {
  const rows = await prisma.organizationPlugin.findMany({ where: { organizationId, enabled: true } });
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    kind: r.kind,
    url: r.url,
    method: r.method,
    inputSchema: (r.inputSchema as Record<string, unknown> | null) ?? undefined,
    headers: r.headersEncrypted
      ? (keyring().decryptJson(r.headersEncrypted, aad(organizationId, r.slug)) as Record<string, string>)
      : undefined,
  }));
}

/** Agent tools contributed by the organization's enabled plugins. Broken plugins are logged and skipped. */
export async function pluginTools(organizationId: string): Promise<Tool[]> {
  const defs = await definitionsFor(organizationId);
  if (defs.length === 0) return [];
  return buildPluginTools(defs, {
    onError: (plugin, error) => logger.warn("plugin unavailable", { plugin: plugin.slug, ...errorInfo(error) }),
  });
}

/** Names of the tools each plugin currently exposes (for display in the composer menu). */
export async function pluginSummaries(organizationId: string): Promise<{ slug: string; name: string; description: string; kind: string }[]> {
  const rows = await prisma.organizationPlugin.findMany({
    where: { organizationId, enabled: true },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, description: true, kind: true },
  });
  return rows;
}

async function probe(def: PluginDefinition): Promise<string> {
  if (def.kind === "MCP") {
    const tools = await new McpClient(def.url, def.headers).listTools();
    return `ok: ${tools.length} tool(s) — ${tools
      .slice(0, 8)
      .map((t) => t.name)
      .join(", ")}`;
  }
  const url = new URL(def.url);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
    return "error: use HTTPS";
  return "ok";
}

export async function savePlugin(ctx: OrgContext, input: PluginInput, id?: string) {
  const organizationId = ctx.organization.id;
  if (!getEnv().PLUGIN_ALLOW_PRIVATE_URLS && !isPublicHttpUrl(input.url))
    throw new ApiError(
      400,
      "Plugin URL must be a public http(s) address. Set PLUGIN_ALLOW_PRIVATE_URLS=1 to allow private networks.",
      "invalid_url",
    );
  const existing = id
    ? await prisma.organizationPlugin.findFirst({ where: { id, organizationId } })
    : null;
  if (id && !existing) throw new ApiError(404, "Plugin not found", "not_found");
  const slug = existing?.slug ?? slugify(input.name);
  const headers =
    input.headers && Object.keys(input.headers).length > 0
      ? input.headers
      : existing?.headersEncrypted
        ? (keyring().decryptJson(existing.headersEncrypted, aad(organizationId, slug)) as Record<string, string>)
        : undefined;
  const def: PluginDefinition = {
    slug,
    name: input.name,
    description: input.description,
    kind: input.kind,
    url: input.url,
    method: input.method,
    inputSchema: input.inputSchema,
    headers,
  };
  let status: string;
  try {
    status = await probe(def);
  } catch (e) {
    status = `error: ${(e as Error).message}`;
  }
  const data = {
    name: input.name,
    description: input.description,
    kind: input.kind,
    url: input.url,
    method: input.method,
    inputSchema: (input.inputSchema as Prisma.InputJsonObject | undefined) ?? undefined,
    headersEncrypted: headers ? keyring().encryptJson(headers, aad(organizationId, slug)) : null,
    lastTestedAt: new Date(),
    lastTestStatus: status,
  };
  const row = existing
    ? await prisma.organizationPlugin.update({ where: { id: existing.id }, data, select: pluginSelect })
    : await prisma.organizationPlugin.create({
        data: { ...data, organizationId, slug, createdById: ctx.user.id },
        select: pluginSelect,
      });
  await audit(ctx, existing ? "plugin.update" : "plugin.create", "OrganizationPlugin", row.id, {
    slug,
    kind: input.kind,
    url: input.url,
    status,
  });
  return row;
}

export async function setPluginEnabled(ctx: OrgContext, id: string, enabled: boolean) {
  const row = await prisma.organizationPlugin.findFirst({ where: { id, organizationId: ctx.organization.id } });
  if (!row) throw new ApiError(404, "Plugin not found", "not_found");
  const updated = await prisma.organizationPlugin.update({ where: { id }, data: { enabled }, select: { id: true, enabled: true } });
  await audit(ctx, "plugin.toggle", "OrganizationPlugin", id, { enabled });
  return updated;
}

export async function deletePlugin(ctx: OrgContext, id: string) {
  const row = await prisma.organizationPlugin.findFirst({ where: { id, organizationId: ctx.organization.id } });
  if (!row) throw new ApiError(404, "Plugin not found", "not_found");
  await prisma.organizationPlugin.delete({ where: { id } });
  await audit(ctx, "plugin.delete", "OrganizationPlugin", id, { slug: row.slug });
}
