import { z } from "zod";
import { json, notFound, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { queues } from "@/lib/queue";

const input = z.object({
  whatsappAccountId: z.string(),
  name: z.string().min(1).max(120),
  templateName: z.string().min(1),
  templateLanguage: z.string().min(2),
  audience: z.object({
    tags: z.array(z.string()).default([]),
    contactIds: z.array(z.string()).default([]),
    excludeOptedOut: z.boolean().default(true),
  }),
  parameters: z.record(z.string(), z.string()).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

export const GET = (req: Request) =>
  withOrg(req, "whatsapp:view", async (ctx) =>
    json({
      campaigns: await prisma.campaign.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: { createdAt: "desc" },
      }),
    }),
  );

export const POST = (req: Request) =>
  withOrg(req, "whatsapp:manage", async (ctx) => {
    const body = await parseBody(req, input);
    const account = await prisma.whatsAppAccount.findFirst({
      where: { id: body.whatsappAccountId, organizationId: ctx.organization.id },
    });
    if (!account) throw notFound("WhatsApp account");
    const template = await prisma.whatsAppTemplate.findFirst({
      where: {
        whatsappAccountId: account.id,
        name: body.templateName,
        language: body.templateLanguage,
        status: "APPROVED",
      },
    });
    if (!template)
      return json({ error: "bad_request", message: "Template is not approved for this account" }, { status: 400 });
    const audienceWhere = {
      organizationId: ctx.organization.id,
      ...(body.audience.excludeOptedOut ? { optedOut: false } : {}),
      ...(body.audience.tags.length || body.audience.contactIds.length
        ? {
            OR: [
              ...(body.audience.tags.length ? [{ tags: { hasSome: body.audience.tags } }] : []),
              ...(body.audience.contactIds.length ? [{ id: { in: body.audience.contactIds } }] : []),
            ],
          }
        : {}),
    };
    const totalRecipients = await prisma.contact.count({ where: audienceWhere });
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: ctx.organization.id,
        whatsappAccountId: account.id,
        name: body.name,
        templateName: body.templateName,
        templateLanguage: body.templateLanguage,
        audience: body.audience,
        parameters: body.parameters,
        status: "SCHEDULED",
        scheduledAt,
        totalRecipients,
        createdById: ctx.user.id,
      },
    });
    await queues().enqueue(
      "campaigns",
      `campaign:${campaign.id}`,
      { campaignId: campaign.id, organizationId: ctx.organization.id },
      { delayMs: Math.max(0, scheduledAt.getTime() - Date.now()) },
    );
    await audit(ctx, "campaign.create", "Campaign", campaign.id, { totalRecipients }, req);
    return json({ campaign }, { status: 201 });
  });
