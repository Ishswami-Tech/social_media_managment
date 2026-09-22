import { z } from "zod";
import { json, parseBody, withSuperAdmin } from "@/lib/api";
import { platformConnectionAad } from "@/lib/ai";
import { auditPlatform } from "@/lib/audit";
import { keyring, prisma } from "@/lib/db";
import { platformAIConsole, testConnection, testStatus } from "@/lib/services/platform-ai";

const modelList = z.array(z.string().min(1).max(200)).max(200).optional();

export const GET = (req: Request) => withSuperAdmin(req, async () => json(await platformAIConsole()));

const createSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.string().min(1).max(50),
  baseUrl: z.url().max(500).optional(),
  apiKey: z.string().min(8).max(500),
  models: modelList,
});

export const POST = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const input = await parseBody(req, createSchema);
    const apiKey = input.apiKey.trim();
    const result = await testConnection(input.provider, apiKey, input.baseUrl);

    // The key's AAD is bound to the row id, so the row has to exist before it can be
    // encrypted. Both statements run in one transaction, so no half-written row is visible.
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.platformAIConnection.create({
        data: {
          name: input.name,
          provider: input.provider,
          baseUrl: input.baseUrl ?? null,
          apiKeyEncrypted: "",
          models: input.models?.length ? JSON.stringify(input.models) : null,
          lastTestedAt: new Date(),
          lastTestStatus: testStatus(result),
          createdById: session.user.id,
        },
      });
      return tx.platformAIConnection.update({
        where: { id: created.id },
        data: { apiKeyEncrypted: keyring().encrypt(apiKey, platformConnectionAad(created.id)) },
        select: { id: true, name: true, provider: true, baseUrl: true, enabled: true, lastTestStatus: true },
      });
    });

    await auditPlatform(session.user.id, "admin.ai_connection.create", "PlatformAIConnection", row.id, {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl ?? null,
      testOk: result.ok,
    });

    return json({ connection: row, test: result }, { status: 201 });
  });

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  provider: z.string().min(1).max(50),
  baseUrl: z.url().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  models: modelList,
});

export const PUT = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const input = await parseBody(req, updateSchema);
    const existing = await prisma.platformAIConnection.findUnique({ where: { id: input.id } });
    if (!existing) return json({ error: "not_found", message: "Connection not found" }, { status: 404 });

    const aad = platformConnectionAad(existing.id);
    const replacement = input.apiKey?.trim();
    let apiKey: string | undefined;
    try {
      apiKey = replacement && replacement.length > 0 ? replacement : keyring().decrypt(existing.apiKeyEncrypted, aad);
    } catch {
      apiKey = undefined;
    }
    const result = apiKey
      ? await testConnection(input.provider, apiKey, input.baseUrl)
      : { ok: false, message: "Stored key could not be read — enter it again", modelCount: 0 };

    const row = await prisma.platformAIConnection.update({
      where: { id: input.id },
      data: {
        name: input.name,
        provider: input.provider,
        baseUrl: input.baseUrl ?? null,
        models: input.models?.length ? JSON.stringify(input.models) : null,
        lastTestedAt: new Date(),
        lastTestStatus: testStatus(result),
        ...(replacement && apiKey ? { apiKeyEncrypted: keyring().encrypt(apiKey, aad) } : {}),
      },
      select: { id: true, name: true, provider: true, baseUrl: true, enabled: true, lastTestStatus: true },
    });

    await auditPlatform(session.user.id, "admin.ai_connection.update", "PlatformAIConnection", row.id, {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl ?? null,
      keyReplaced: !!replacement,
      testOk: result.ok,
    });

    return json({ connection: row, test: result });
  });

export const PATCH = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const { id, enabled } = await parseBody(req, z.object({ id: z.string().min(1), enabled: z.boolean() }));
    const existing = await prisma.platformAIConnection.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return json({ error: "not_found", message: "Connection not found" }, { status: 404 });

    const row = await prisma.platformAIConnection.update({
      where: { id },
      data: { enabled },
      select: { id: true, name: true, enabled: true },
    });
    await auditPlatform(session.user.id, "admin.ai_connection.toggle", "PlatformAIConnection", id, { enabled });
    return json({ connection: row });
  });

export const DELETE = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const { id } = await parseBody(req, z.object({ id: z.string().min(1) }));
    const existing = await prisma.platformAIConnection.findUnique({
      where: { id },
      select: { id: true, name: true, provider: true },
    });
    if (!existing) return json({ error: "not_found", message: "Connection not found" }, { status: 404 });

    await prisma.platformAIConnection.delete({ where: { id } });
    await auditPlatform(session.user.id, "admin.ai_connection.delete", "PlatformAIConnection", id, {
      name: existing.name,
      provider: existing.provider,
    });
    return json({ ok: true });
  });
