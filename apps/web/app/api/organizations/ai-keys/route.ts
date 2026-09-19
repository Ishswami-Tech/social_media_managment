import { z } from "zod";
import { AI_PROVIDERS } from "@platform/types";
import { json, parseBody, withOrg } from "@/lib/api";
import { aiProvider } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { keyring, prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const keys = await prisma.organizationAIKey.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, provider: true, label: true, active: true, createdAt: true },
    });
    return json({ keys });
  });

export const POST = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const input = await parseBody(
      req,
      z.object({
        provider: z.enum(AI_PROVIDERS),
        apiKey: z.string().min(10).max(500),
        label: z.string().max(80).optional(),
      }),
    );
    const health = await aiProvider(input.provider).healthCheck?.({ apiKey: input.apiKey });
    if (health && !health.ok)
      return json(
        { error: "invalid_key", message: `Key rejected by ${input.provider}: ${health.message ?? "unknown"}` },
        { status: 400 },
      );
    const row = await prisma.organizationAIKey.upsert({
      where: { organizationId_provider: { organizationId: ctx.organization.id, provider: input.provider } },
      create: {
        organizationId: ctx.organization.id,
        provider: input.provider,
        label: input.label,
        keyEncrypted: keyring().encrypt(input.apiKey, `ai-key:${ctx.organization.id}:${input.provider}`),
      },
      update: {
        label: input.label,
        active: true,
        keyEncrypted: keyring().encrypt(input.apiKey, `ai-key:${ctx.organization.id}:${input.provider}`),
      },
      select: { id: true, provider: true, label: true, active: true },
    });
    await audit(ctx, "ai.key.set", "OrganizationAIKey", row.id, { provider: input.provider }, req);
    return json({ key: row }, { status: 201 });
  });

export const DELETE = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { provider } = await parseBody(req, z.object({ provider: z.enum(AI_PROVIDERS) }));
    await prisma.organizationAIKey.deleteMany({ where: { organizationId: ctx.organization.id, provider } });
    await audit(ctx, "ai.key.delete", "OrganizationAIKey", null, { provider }, req);
    return json({ ok: true });
  });
