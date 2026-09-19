import { z } from "zod";
import {
  messagePreview,
  normalizePhone,
  serviceWindowEnd,
  WhatsAppClient,
  type InboundMessage,
  type StatusUpdate,
  type TemplateStatusUpdate,
} from "@platform/whatsapp";
import type { Prisma } from "@platform/database";
import { ApiError, badRequest, conflict, notFound } from "../api";
import { audit } from "../audit";
import { keyring, prisma } from "../db";
import { logger, errorInfo } from "../logger";
import { queues } from "../queue";
import type { OrgContext } from "../session";

const aad = (id: string) => `whatsapp-account:${id}`;

export const connectWhatsAppInput = z.object({
  wabaId: z.string().min(3),
  phoneNumberId: z.string().min(3),
  accessToken: z.string().min(10),
});

/** Connect a WhatsApp Business phone number using a System User / Embedded Signup token. */
export async function connectWhatsAppAccount(ctx: OrgContext, input: z.infer<typeof connectWhatsAppInput>) {
  const numbers = await WhatsAppClient.getPhoneNumbers(input.accessToken, input.wabaId);
  const phone = numbers.find((n) => n.id === input.phoneNumberId);
  if (!phone) throw badRequest("Phone number id does not belong to that WhatsApp Business Account");
  const placeholder = await prisma.whatsAppAccount.upsert({
    where: {
      organizationId_phoneNumberId: { organizationId: ctx.organization.id, phoneNumberId: input.phoneNumberId },
    },
    create: {
      organizationId: ctx.organization.id,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
      qualityRating: phone.quality_rating,
      accessTokenEncrypted: "pending",
    },
    update: {
      wabaId: input.wabaId,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
      qualityRating: phone.quality_rating,
      status: "CONNECTED",
    },
  });
  const account = await prisma.whatsAppAccount.update({
    where: { id: placeholder.id },
    data: { accessTokenEncrypted: keyring().encrypt(input.accessToken, aad(placeholder.id)) },
  });
  await syncTemplates(account.id);
  await audit(ctx, "whatsapp.connect", "WhatsAppAccount", account.id, { phone: account.displayPhoneNumber });
  return account;
}

export async function clientFor(whatsappAccountId: string) {
  const account = await prisma.whatsAppAccount.findUnique({ where: { id: whatsappAccountId } });
  if (!account) throw notFound("WhatsApp account");
  const accessToken = keyring().decrypt(account.accessTokenEncrypted, aad(account.id));
  return { account, accessToken, client: new WhatsAppClient({ accessToken, phoneNumberId: account.phoneNumberId }) };
}

export async function syncTemplates(whatsappAccountId: string) {
  const { account, accessToken } = await clientFor(whatsappAccountId);
  const templates = await WhatsAppClient.listTemplates(accessToken, account.wabaId);
  for (const t of templates) {
    await prisma.whatsAppTemplate.upsert({
      where: { whatsappAccountId_externalTemplateId: { whatsappAccountId: account.id, externalTemplateId: t.id } },
      create: {
        organizationId: account.organizationId,
        whatsappAccountId: account.id,
        externalTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components as Prisma.InputJsonValue,
      },
      update: {
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components as Prisma.InputJsonValue,
      },
    });
  }
  return templates.length;
}

// ---- inbound ----

export async function handleInboundMessage(ev: InboundMessage) {
  const account = await prisma.whatsAppAccount.findFirst({ where: { phoneNumberId: ev.phoneNumberId } });
  if (!account)
    return logger.warn("inbound WhatsApp message for unknown phone number", { phoneNumberId: ev.phoneNumberId });
  const organizationId = account.organizationId;
  const phone = normalizePhone(ev.from);
  const contact = await prisma.contact.upsert({
    where: { organizationId_phone: { organizationId, phone } },
    create: { organizationId, phone, name: ev.contactName, lastSeenAt: ev.timestamp },
    update: { name: ev.contactName ?? undefined, lastSeenAt: ev.timestamp },
  });
  const preview = messagePreview(ev.type, ev.content);
  const conversation = await prisma.conversation.upsert({
    where: {
      organizationId_whatsappAccountId_contactId: {
        organizationId,
        whatsappAccountId: account.id,
        contactId: contact.id,
      },
    },
    create: {
      organizationId,
      whatsappAccountId: account.id,
      contactId: contact.id,
      status: "OPEN",
      unreadCount: 1,
      lastMessageAt: ev.timestamp,
      lastMessagePreview: preview,
      serviceWindowEndsAt: serviceWindowEnd(ev.timestamp),
    },
    update: {
      status: "OPEN",
      unreadCount: { increment: 1 },
      lastMessageAt: ev.timestamp,
      lastMessagePreview: preview,
      serviceWindowEndsAt: serviceWindowEnd(ev.timestamp),
    },
  });
  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        externalMessageId: ev.externalMessageId,
        type: ev.type,
        content: ev.content as Prisma.InputJsonValue,
        status: "RECEIVED",
        sentAt: ev.timestamp,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return; // duplicate delivery
    throw e;
  }
  await runAutomations(organizationId, conversation.id, ev);
}

export async function handleStatusUpdate(ev: StatusUpdate) {
  const msg = await prisma.message.findUnique({ where: { externalMessageId: ev.externalMessageId } });
  if (!msg) return;
  const rank: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4, RECEIVED: 0 };
  if ((rank[ev.status] ?? 0) < (rank[msg.status] ?? 0) && ev.status !== "FAILED") return; // out-of-order
  await prisma.message.update({
    where: { id: msg.id },
    data: {
      status: ev.status,
      deliveredAt: ev.status === "DELIVERED" ? ev.timestamp : undefined,
      readAt: ev.status === "READ" ? ev.timestamp : undefined,
      errorCode: ev.errorCode,
      errorMessage: ev.errorMessage,
    },
  });
}

export async function handleTemplateStatus(ev: TemplateStatusUpdate) {
  await prisma.whatsAppTemplate.updateMany({
    where: { externalTemplateId: ev.externalTemplateId, whatsappAccount: { wabaId: ev.wabaId } },
    data: { status: ev.status },
  });
}

// ---- outbound ----

export const sendMessageInput = z.object({
  conversationId: z.string().min(1),
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "TEMPLATE"]).default("TEXT"),
  text: z.string().max(4096).optional(),
  mediaUrl: z.string().url().optional(),
  caption: z.string().max(1024).optional(),
  template: z
    .object({ name: z.string(), language: z.string(), components: z.array(z.unknown()).default([]) })
    .optional(),
  aiSuggested: z.boolean().default(false),
});

/** Create an outbound message (PENDING) and enqueue delivery. */
export async function sendMessage(ctx: OrgContext, input: z.infer<typeof sendMessageInput>) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: ctx.organization.id },
    include: { contact: true },
  });
  if (!conversation) throw notFound("Conversation");
  if (!conversation.whatsappAccountId) throw conflict("Conversation has no WhatsApp account");
  if (conversation.contact.optedOut) throw conflict("Contact has opted out");
  const insideWindow = !!conversation.serviceWindowEndsAt && conversation.serviceWindowEndsAt.getTime() > Date.now();
  if (input.type !== "TEMPLATE" && !insideWindow)
    throw conflict("Outside the 24-hour service window: send an approved template instead");
  if (input.type === "TEXT" && !input.text) throw badRequest("text is required");
  if (input.type === "TEMPLATE" && !input.template) throw badRequest("template is required");
  const content =
    input.type === "TEXT"
      ? { text: input.text }
      : input.type === "TEMPLATE"
        ? {
            templateName: input.template!.name,
            language: input.template!.language,
            components: input.template!.components,
          }
        : { mediaUrl: input.mediaUrl, caption: input.caption };
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      type: input.type,
      content: content as Prisma.InputJsonValue,
      status: "PENDING",
      sentById: ctx.user.id,
      aiSuggested: input.aiSuggested,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: messagePreview(input.type, content as Record<string, unknown>),
      unreadCount: 0,
    },
  });
  await queues().enqueue("whatsapp-outbound", `wa-out:${message.id}`, {
    messageId: message.id,
    organizationId: ctx.organization.id,
  });
  return message;
}

/** Worker: actually deliver a PENDING outbound message. */
export async function deliverOutbound(messageId: string) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { contact: true } } },
  });
  if (!msg || msg.direction !== "OUTBOUND" || msg.status !== "PENDING") return;
  if (msg.externalMessageId) return; // already delivered
  const { client } = await clientFor(msg.conversation.whatsappAccountId!);
  const to = msg.conversation.contact.phone;
  const c = msg.content as Record<string, unknown>;
  try {
    let result;
    if (msg.type === "TEXT") result = await client.sendText(to, String(c.text));
    else if (msg.type === "TEMPLATE")
      result = await client.sendTemplate(
        to,
        String(c.templateName),
        String(c.language),
        (c.components as never[]) ?? [],
      );
    else
      result = await client.sendMedia(to, msg.type.toLowerCase() as "image" | "video" | "document", {
        link: String(c.mediaUrl),
        caption: c.caption ? String(c.caption) : undefined,
      });
    await prisma.message.update({
      where: { id: msg.id },
      data: { status: "SENT", externalMessageId: result.messageId, sentAt: new Date() },
    });
  } catch (e) {
    logger.warn("whatsapp delivery failed", { messageId, ...errorInfo(e) });
    await prisma.message.update({
      where: { id: msg.id },
      data: {
        status: "FAILED",
        errorCode: (e as { code?: string }).code ?? "UNKNOWN",
        errorMessage: (e as Error).message.slice(0, 1000),
      },
    });
    if ((e as { retryable?: boolean }).retryable) throw e; // let BullMQ surface it as failed for observability
  }
}

// ---- automations (keyword / new conversation -> reply / assign / tag) ----

async function runAutomations(organizationId: string, conversationId: string, ev: InboundMessage) {
  const automations = await prisma.automation.findMany({ where: { organizationId, status: "ACTIVE" } });
  if (automations.length === 0) return;
  const text = typeof ev.content.text === "string" ? ev.content.text.toLowerCase() : "";
  const isNew = (await prisma.message.count({ where: { conversationId } })) === 1;
  for (const a of automations) {
    const trigger = a.trigger as { type: string; keywords?: string[] };
    const matches =
      trigger.type === "INBOUND_MESSAGE" ||
      (trigger.type === "NEW_CONVERSATION" && isNew) ||
      (trigger.type === "KEYWORD" && (trigger.keywords ?? []).some((k) => text.includes(k.toLowerCase())));
    if (!matches) continue;
    for (const action of a.actions as {
      type: string;
      text?: string;
      userId?: string;
      tag?: string;
      templateName?: string;
      language?: string;
    }[]) {
      try {
        if (action.type === "SEND_TEXT" && action.text) {
          const message = await prisma.message.create({
            data: {
              conversationId,
              direction: "OUTBOUND",
              type: "TEXT",
              content: { text: action.text },
              status: "PENDING",
            },
          });
          await queues().enqueue("whatsapp-outbound", `wa-out:${message.id}`, {
            messageId: message.id,
            organizationId,
          });
        } else if (action.type === "ASSIGN" && action.userId) {
          await prisma.conversation.update({ where: { id: conversationId }, data: { assigneeId: action.userId } });
        } else if (action.type === "TAG" && action.tag) {
          const convo = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { contactId: true },
          });
          if (convo)
            await prisma.contact.update({ where: { id: convo.contactId }, data: { tags: { push: action.tag } } });
        }
      } catch (e) {
        logger.warn("automation action failed", { automationId: a.id, ...errorInfo(e) });
      }
    }
    await prisma.automation.update({
      where: { id: a.id },
      data: { runCount: { increment: 1 }, lastRunAt: new Date() },
    });
  }
}

export async function assertConversation(ctx: OrgContext, conversationId: string) {
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, organizationId: ctx.organization.id } });
  if (!c) throw new ApiError(404, "Conversation not found", "not_found");
  return c;
}
