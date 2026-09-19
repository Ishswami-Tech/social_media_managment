import { handleMetaVerification, parseMetaEnvelope, verifyMetaSignature } from "@platform/social-meta";
import { getEnv } from "@/lib/env";
import { logger, errorInfo } from "@/lib/logger";
import { ingestWebhook } from "@/lib/services/webhooks";

/**
 * Single Meta webhook endpoint for Facebook Pages, Instagram and WhatsApp
 * (spec §18). Signature is verified over the raw body; the event is stored
 * idempotently and processed by the webhook worker. Always answers fast.
 */
export async function GET(req: Request) {
  const env = getEnv();
  if (!env.META_WEBHOOK_VERIFY_TOKEN) return new Response("Not configured", { status: 503 });
  const result = handleMetaVerification(new URL(req.url).searchParams, env.META_WEBHOOK_VERIFY_TOKEN);
  return result.ok ? new Response(result.challenge, { status: 200 }) : new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const env = getEnv();
  if (!env.META_APP_SECRET) return new Response("Not configured", { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(env.META_APP_SECRET, raw, req.headers.get("x-hub-signature-256"))) {
    logger.warn("meta webhook signature mismatch");
    return new Response("Invalid signature", { status: 401 });
  }
  try {
    const envelope = parseMetaEnvelope(JSON.parse(raw));
    const provider = envelope.object === "whatsapp_business_account" ? "WHATSAPP" : "META";
    // One delivery can carry many entries; store one event per entry so partial failures stay isolated.
    for (const entry of envelope.entry) {
      const eventType = entry.changes?.[0]?.field ?? (entry.messaging ? "messaging" : "unknown");
      await ingestWebhook({
        provider,
        eventType: `${envelope.object}.${eventType}`,
        payload: { object: envelope.object, entry: [entry] },
      });
    }
  } catch (e) {
    logger.error("meta webhook ingest failed", errorInfo(e));
    // Still 200: Meta retries aggressively on non-2xx and the payload is malformed anyway.
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
