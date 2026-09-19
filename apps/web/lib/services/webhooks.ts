import { sha256Hex } from "@platform/encryption";
import { parseWhatsAppWebhook } from "@platform/whatsapp";
import type { Prisma } from "@platform/database";
import { prisma } from "../db";
import { logger, errorInfo } from "../logger";
import { queues } from "../queue";
import { handleInboundMessage, handleStatusUpdate, handleTemplateStatus } from "./whatsapp";

/**
 * Persist an event idempotently and enqueue it for async processing (spec §18).
 * Returns false when the event was already seen.
 */
export async function ingestWebhook(input: {
  provider: string;
  externalEventId?: string;
  eventType: string;
  payload: unknown;
  organizationId?: string | null;
}): Promise<{ id: string; duplicate: boolean }> {
  const externalEventId = input.externalEventId ?? sha256Hex(JSON.stringify(input.payload));
  try {
    const row = await prisma.webhookEvent.create({
      data: {
        provider: input.provider,
        externalEventId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        organizationId: input.organizationId ?? null,
      },
    });
    await queues().enqueue("webhooks", `webhook:${row.id}`, { webhookEventId: row.id });
    return { id: row.id, duplicate: false };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const existing = await prisma.webhookEvent.findUnique({
        where: { provider_externalEventId: { provider: input.provider, externalEventId } },
        select: { id: true },
      });
      return { id: existing!.id, duplicate: true };
    }
    throw e;
  }
}

/** Worker entry: dispatch a stored event to the right domain handler. */
export async function processWebhookEvent(webhookEventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event || event.status === "PROCESSED") return;
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });
  try {
    let handled = false;
    if (event.provider === "WHATSAPP") {
      const events = parseWhatsAppWebhook(event.payload);
      for (const ev of events) {
        if (ev.kind === "message") await handleInboundMessage(ev);
        else if (ev.kind === "status") await handleStatusUpdate(ev);
        else await handleTemplateStatus(ev);
      }
      handled = events.length > 0;
    } else if (event.provider === "META") {
      // Page / Instagram change notifications (comments, mentions, insights) are
      // stored for analytics; no synchronous domain mutation is required yet.
      handled = true;
    }
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: handled ? "PROCESSED" : "IGNORED", processedAt: new Date() },
    });
  } catch (e) {
    logger.error("webhook processing failed", { webhookEventId, ...errorInfo(e) });
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", error: (e as Error).message.slice(0, 2000) },
    });
    throw e;
  }
}
