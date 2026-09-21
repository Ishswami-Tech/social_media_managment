import { z } from "zod";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiProvider } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { keyring, prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const [connections, keys] = await Promise.all([
      prisma.organizationAIConnection.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          provider: true,
          baseUrl: true,
          models: true,
          isActive: true,
          lastTestedAt: true,
          lastTestStatus: true,
          createdAt: true,
        },
      }),
      prisma.organizationAIKey.findMany({
        where: { organizationId: ctx.organization.id },
        select: { id: true, provider: true, label: true, active: true, createdAt: true },
      }),
    ]);
    return json({ connections, keys });
  });

const createSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.string().min(1).max(50), // free-text — any AI provider name
  baseUrl: z.string().url().max(500),
  apiKey: z.string().min(10).max(500),
  modelIds: z.array(z.string().min(1)).max(50).optional().default([]),
});

export const POST = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const input = await parseBody(req, createSchema);

    // If it's a known provider, health-check against it; otherwise just verify HTTPS
    let testStatus: string | undefined;
    try {
      const known = ["OPENAI", "ANTHROPIC", "GOOGLE"] as const;
      if (known.includes(input.provider as (typeof known)[number])) {
        const impl = aiProvider(input.provider as "OPENAI" | "ANTHROPIC" | "GOOGLE");
        const health = await impl.healthCheck?.({ apiKey: input.apiKey, baseUrl: input.baseUrl });
        testStatus = health?.ok ? "ok" : `error: ${health?.message ?? "unknown"}`;
      } else {
        // Unknown provider — just validate HTTPS
        const url = new URL(input.baseUrl);
        testStatus = url.protocol === "https:" ? "ok" : "error: use HTTPS";
      }
    } catch (e) {
      testStatus = `error: ${(e as Error).message}`;
    }

    const encrypted = keyring().encrypt(input.apiKey, `ai-conn:${ctx.organization.id}:${input.name}`);
    const row = await prisma.organizationAIConnection.create({
      data: {
        organizationId: ctx.organization.id,
        name: input.name,
        provider: input.provider,
        baseUrl: input.baseUrl,
        apiKeyEncrypted: encrypted,
        models: input.modelIds.length > 0 ? JSON.stringify(input.modelIds) : null,
        lastTestedAt: new Date(),
        lastTestStatus: testStatus,
      },
      select: { id: true, name: true, provider: true, baseUrl: true, models: true, isActive: true, lastTestStatus: true },
    });

    await audit(ctx, "ai.connection.create", "OrganizationAIConnection", row.id, {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
    }, req);

    return json({ connection: row }, { status: 201 });
  });

export const DELETE = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id } = await parseBody(req, z.object({ id: z.string().min(1) }));
    const existing = await prisma.organizationAIConnection.findFirst({
      where: { id, organizationId: ctx.organization.id },
      select: { id: true, name: true, provider: true },
    });
    if (!existing) return json({ error: "not_found" }, { status: 404 });

    await prisma.organizationAIConnection.delete({ where: { id } });
    await audit(ctx, "ai.connection.delete", "OrganizationAIConnection", id, {
      name: existing.name,
      provider: existing.provider,
    }, req);

    return json({ ok: true });
  });

export const PATCH = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { id, isActive } = await parseBody(
      req,
      z.object({ id: z.string().min(1), isActive: z.boolean() }),
    );
    const row = await prisma.organizationAIConnection.findFirst({
      where: { id, organizationId: ctx.organization.id },
      select: { id: true },
    });
    if (!row) return json({ error: "not_found" }, { status: 404 });

    const updated = await prisma.organizationAIConnection.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });

    await audit(ctx, "ai.connection.toggle", "OrganizationAIConnection", id, { isActive }, req);
    return json({ connection: updated });
  });

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  provider: z.string().min(1).max(50),
  baseUrl: z.string().url().max(500),
  modelIds: z.array(z.string().min(1)).max(50).optional().default([]),
  apiKey: z.string().max(500).optional(), // empty string means "keep current"
});

export const PUT = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const input = await parseBody(req, updateSchema);

    const existing = await prisma.organizationAIConnection.findFirst({
      where: { id: input.id, organizationId: ctx.organization.id },
      select: { id: true, apiKeyEncrypted: true, name: true, provider: true },
    });
    if (!existing) return json({ error: "not_found" }, { status: 404 });

    const updateData: Record<string, unknown> = {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      models: input.modelIds.length > 0 ? JSON.stringify(input.modelIds) : null,
    };

    // Only re-encrypt key if a new one was provided
    if (input.apiKey && input.apiKey.trim().length > 0) {
      updateData.apiKeyEncrypted = keyring().encrypt(input.apiKey.trim(), `ai-conn:${ctx.organization.id}:${input.name}`);
    }

    // Re-test connection if known provider
    let testStatus: string | undefined;
    try {
      const known = ["OPENAI", "ANTHROPIC", "GOOGLE"] as const;
      if (known.includes(input.provider as (typeof known)[number])) {
        const apiKeyToTest = input.apiKey && input.apiKey.trim() ? input.apiKey.trim() : undefined;
        if (apiKeyToTest) {
          try {
            const impl = aiProvider(input.provider as "OPENAI" | "ANTHROPIC" | "GOOGLE");
            const testBase = input.baseUrl.trim();
            const health = await impl.healthCheck?.({ apiKey: apiKeyToTest, baseUrl: testBase });
            testStatus = health?.ok ? "ok" : `error: ${health?.message ?? "unknown"}`;
          } catch {
            testStatus = "error: test failed";
          }
        }
      }
    } catch {
      // Ignore test errors on update
    }

    if (testStatus !== undefined) {
      updateData.lastTestedAt = new Date();
      updateData.lastTestStatus = testStatus;
    }

    const updated = await prisma.organizationAIConnection.update({
      where: { id: input.id },
      data: updateData,
      select: { id: true, name: true, provider: true, baseUrl: true, models: true, isActive: true, lastTestStatus: true },
    });

    await audit(ctx, "ai.connection.update", "OrganizationAIConnection", input.id, {
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
    }, req);

    return json({ connection: updated });
  });
