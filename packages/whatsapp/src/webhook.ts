import type { MessageStatus, MessageType } from "@platform/types";

export interface InboundMessage {
  kind: "message";
  phoneNumberId: string;
  displayPhoneNumber?: string;
  wabaId: string;
  from: string; // wa_id
  contactName?: string;
  externalMessageId: string;
  timestamp: Date;
  type: MessageType;
  content: Record<string, unknown>;
  replyToMessageId?: string;
}

export interface StatusUpdate {
  kind: "status";
  phoneNumberId: string;
  wabaId: string;
  externalMessageId: string;
  recipient: string;
  status: MessageStatus;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface TemplateStatusUpdate {
  kind: "template_status";
  wabaId: string;
  externalTemplateId: string;
  name: string;
  language: string;
  status: string;
  reason?: string;
}

export type WhatsAppEvent = InboundMessage | StatusUpdate | TemplateStatusUpdate;

const TYPE_MAP: Record<string, MessageType> = {
  text: "TEXT",
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
  sticker: "STICKER",
  location: "LOCATION",
  contacts: "CONTACTS",
  interactive: "INTERACTIVE",
  button: "INTERACTIVE",
  reaction: "REACTION",
};

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

/**
 * Flattens a "whatsapp_business_account" webhook envelope into typed events.
 * Unknown fields are ignored rather than rejected so new Meta features never
 * break ingestion.
 */
export function parseWhatsAppWebhook(body: unknown): WhatsAppEvent[] {
  const env = body as {
    object?: string;
    entry?: { id: string; changes?: { field: string; value: Record<string, unknown> }[] }[];
  };
  if (env?.object !== "whatsapp_business_account" || !Array.isArray(env.entry)) return [];
  const out: WhatsAppEvent[] = [];
  for (const entry of env.entry) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (change.field === "message_template_status_update") {
        out.push({
          kind: "template_status",
          wabaId: entry.id,
          externalTemplateId: String(v.message_template_id),
          name: String(v.message_template_name),
          language: String(v.message_template_language),
          status: String(v.event),
          reason: v.reason ? String(v.reason) : undefined,
        });
        continue;
      }
      if (change.field !== "messages") continue;
      const meta = (v.metadata ?? {}) as { phone_number_id?: string; display_phone_number?: string };
      const phoneNumberId = meta.phone_number_id ?? "";
      const contacts = (v.contacts ?? []) as { wa_id: string; profile?: { name?: string } }[];
      for (const m of (v.messages ?? []) as Record<string, unknown>[]) {
        const rawType = String(m.type ?? "unknown");
        const type = TYPE_MAP[rawType] ?? "UNKNOWN";
        const contact = contacts.find((c) => c.wa_id === m.from);
        out.push({
          kind: "message",
          phoneNumberId,
          displayPhoneNumber: meta.display_phone_number,
          wabaId: entry.id,
          from: String(m.from),
          contactName: contact?.profile?.name,
          externalMessageId: String(m.id),
          timestamp: new Date(Number(m.timestamp) * 1000),
          type,
          content: extractContent(rawType, m),
          replyToMessageId: (m.context as { id?: string } | undefined)?.id,
        });
      }
      for (const s of (v.statuses ?? []) as Record<string, unknown>[]) {
        const errors = (s.errors ?? []) as { code?: number; title?: string; message?: string }[];
        out.push({
          kind: "status",
          phoneNumberId,
          wabaId: entry.id,
          externalMessageId: String(s.id),
          recipient: String(s.recipient_id),
          status: STATUS_MAP[String(s.status)] ?? "PENDING",
          timestamp: new Date(Number(s.timestamp) * 1000),
          errorCode: errors[0]?.code !== undefined ? String(errors[0].code) : undefined,
          errorMessage: errors[0]?.message ?? errors[0]?.title,
        });
      }
    }
  }
  return out;
}

function extractContent(rawType: string, m: Record<string, unknown>): Record<string, unknown> {
  const payload = (m[rawType] ?? {}) as Record<string, unknown>;
  switch (rawType) {
    case "text":
      return { text: payload.body };
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return {
        mediaId: payload.id,
        mimeType: payload.mime_type,
        caption: payload.caption,
        filename: payload.filename,
        sha256: payload.sha256,
      };
    case "location":
      return { latitude: payload.latitude, longitude: payload.longitude, name: payload.name, address: payload.address };
    case "interactive": {
      const reply = (payload.button_reply ?? payload.list_reply ?? {}) as Record<string, unknown>;
      return { interactiveType: payload.type, id: reply.id, title: reply.title, text: reply.title };
    }
    case "button":
      return { text: payload.text, payload: payload.payload };
    case "reaction":
      return { emoji: payload.emoji, messageId: payload.message_id };
    case "contacts":
      return { contacts: m.contacts };
    default:
      return { raw: payload };
  }
}

/** Text preview used for conversation lists. */
export function messagePreview(type: MessageType, content: Record<string, unknown>): string {
  if (typeof content.text === "string") return content.text.slice(0, 140);
  if (typeof content.caption === "string") return content.caption.slice(0, 140);
  return `[${type.toLowerCase()}]`;
}
