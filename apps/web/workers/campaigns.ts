import { prisma } from "@/lib/db";
import { logger, errorInfo } from "@/lib/logger";
import { queues } from "@/lib/queue";
import type { Prisma } from "@platform/database";

/**
 * Expands a WhatsApp campaign into one outbound template message per contact.
 * Conversations are created (or reused) so replies land in the shared inbox.
 */
export async function runCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "SCHEDULED") return;
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING", startedAt: new Date() } });
  const audience = campaign.audience as { tags?: string[]; contactIds?: string[]; excludeOptedOut?: boolean };
  const where: Prisma.ContactWhereInput = {
    organizationId: campaign.organizationId,
    ...(audience.excludeOptedOut !== false ? { optedOut: false } : {}),
    ...(audience.tags?.length || audience.contactIds?.length
      ? {
          OR: [
            ...(audience.tags?.length ? [{ tags: { hasSome: audience.tags } }] : []),
            ...(audience.contactIds?.length ? [{ id: { in: audience.contactIds } }] : []),
          ],
        }
      : {}),
  };
  const params = (campaign.parameters as Record<string, string> | null) ?? {};
  const components = Object.keys(params).length
    ? [{ type: "body", parameters: Object.values(params).map((text) => ({ type: "text", text })) }]
    : [];
  let sent = 0;
  let failed = 0;
  const contacts = await prisma.contact.findMany({ where, select: { id: true } });
  for (const contact of contacts) {
    try {
      const conversation = await prisma.conversation.upsert({
        where: {
          organizationId_whatsappAccountId_contactId: {
            organizationId: campaign.organizationId,
            whatsappAccountId: campaign.whatsappAccountId,
            contactId: contact.id,
          },
        },
        create: {
          organizationId: campaign.organizationId,
          whatsappAccountId: campaign.whatsappAccountId,
          contactId: contact.id,
          status: "OPEN",
          lastMessageAt: new Date(),
          lastMessagePreview: `[template ${campaign.templateName}]`,
        },
        update: { lastMessageAt: new Date(), lastMessagePreview: `[template ${campaign.templateName}]` },
      });
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
          type: "TEMPLATE",
          content: { templateName: campaign.templateName, language: campaign.templateLanguage, components, campaignId },
          status: "PENDING",
          sentById: campaign.createdById,
        },
      });
      await queues().enqueue("whatsapp-outbound", `wa-out:${message.id}`, {
        messageId: message.id,
        organizationId: campaign.organizationId,
      });
      sent++;
    } catch (e) {
      failed++;
      logger.warn("campaign recipient failed", { campaignId, contactId: contact.id, ...errorInfo(e) });
    }
  }
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      sentCount: sent,
      failedCount: failed,
      totalRecipients: contacts.length,
    },
  });
}
