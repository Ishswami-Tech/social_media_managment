import { hmacSha256Hex, safeEqual } from "@platform/encryption";

/**
 * Meta signs webhook deliveries with X-Hub-Signature-256: "sha256=<hmac>".
 * Verification MUST run on the raw request body bytes, before JSON parsing.
 */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
): boolean {
  if (!signatureHeader) return false;
  const [algo, provided] = signatureHeader.split("=");
  if (algo !== "sha256" || !provided) return false;
  const expected = hmacSha256Hex(appSecret, rawBody);
  return safeEqual(expected, provided);
}

/** Handles the GET verification handshake when subscribing a webhook. */
export function handleMetaVerification(
  query: URLSearchParams,
  verifyToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");
  if (mode === "subscribe" && token && challenge && safeEqual(token, verifyToken)) return { ok: true, challenge };
  return { ok: false };
}

export interface MetaWebhookEnvelope {
  object: string; // "page" | "instagram" | "whatsapp_business_account" | ...
  entry: { id: string; time?: number; changes?: { field: string; value: unknown }[]; messaging?: unknown[] }[];
}

export function parseMetaEnvelope(body: unknown): MetaWebhookEnvelope {
  if (!body || typeof body !== "object" || !Array.isArray((body as MetaWebhookEnvelope).entry)) {
    throw new Error("Malformed Meta webhook envelope");
  }
  return body as MetaWebhookEnvelope;
}
