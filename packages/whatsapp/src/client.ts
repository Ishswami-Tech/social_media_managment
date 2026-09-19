import { requestJson } from "@platform/social-core";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface WhatsAppAuth {
  accessToken: string;
  phoneNumberId: string;
}

export interface TemplateComponent {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: string;
  parameters: {
    type: "text" | "image" | "video" | "document" | "currency" | "date_time" | "payload";
    text?: string;
    image?: { link: string };
    video?: { link: string };
    document?: { link: string; filename?: string };
    payload?: string;
  }[];
}

export interface SendResult {
  messageId: string;
  waId?: string;
  raw: unknown;
}

interface SendResponse {
  messages: { id: string }[];
  contacts?: { wa_id: string; input: string }[];
}

/**
 * WhatsApp Business Cloud API client (spec §16). Sends free-form messages
 * (only valid inside the 24h service window) and template messages.
 */
export class WhatsAppClient {
  constructor(private readonly auth: WhatsAppAuth) {}

  private send(body: Record<string, unknown>): Promise<SendResult> {
    return requestJson<SendResponse>(`${GRAPH}/${this.auth.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.auth.accessToken}` },
      body: { messaging_product: "whatsapp", recipient_type: "individual", ...body },
    }).then((r) => ({ messageId: r.messages[0]!.id, waId: r.contacts?.[0]?.wa_id, raw: r }));
  }

  sendText(to: string, text: string, opts: { previewUrl?: boolean; replyToMessageId?: string } = {}) {
    return this.send({
      to,
      type: "text",
      text: { body: text, preview_url: opts.previewUrl ?? false },
      ...(opts.replyToMessageId ? { context: { message_id: opts.replyToMessageId } } : {}),
    });
  }

  sendMedia(
    to: string,
    kind: "image" | "video" | "audio" | "document",
    media: { link?: string; id?: string; caption?: string; filename?: string },
  ) {
    return this.send({ to, type: kind, [kind]: media });
  }

  sendTemplate(to: string, name: string, language: string, components: TemplateComponent[] = []) {
    return this.send({ to, type: "template", template: { name, language: { code: language }, components } });
  }

  sendReaction(to: string, messageId: string, emoji: string) {
    return this.send({ to, type: "reaction", reaction: { message_id: messageId, emoji } });
  }

  markRead(messageId: string) {
    return requestJson(`${GRAPH}/${this.auth.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.auth.accessToken}` },
      body: { messaging_product: "whatsapp", status: "read", message_id: messageId },
    });
  }

  /** Resolve a media id from an inbound message to a short-lived download URL. */
  async getMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string; sha256?: string; fileSize?: number }> {
    const r = await requestJson<{ url: string; mime_type: string; sha256?: string; file_size?: number }>(
      `${GRAPH}/${mediaId}`,
      {
        headers: { authorization: `Bearer ${this.auth.accessToken}` },
      },
    );
    return { url: r.url, mimeType: r.mime_type, sha256: r.sha256, fileSize: r.file_size };
  }

  async downloadMedia(url: string): Promise<Buffer> {
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.auth.accessToken}` } });
    if (!res.ok) throw new Error(`Media download failed with ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  static async listTemplates(accessToken: string, wabaId: string) {
    const r = await requestJson<{
      data: { id: string; name: string; language: string; status: string; category?: string; components: unknown[] }[];
    }>(`${GRAPH}/${wabaId}/message_templates?limit=200&fields=id,name,language,status,category,components`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return r.data;
  }

  static async getPhoneNumbers(accessToken: string, wabaId: string) {
    const r = await requestJson<{
      data: { id: string; display_phone_number: string; verified_name?: string; quality_rating?: string }[];
    }>(`${GRAPH}/${wabaId}/phone_numbers`, { headers: { authorization: `Bearer ${accessToken}` } });
    return r.data;
  }
}

/** Normalise a phone number to E.164 digits-only form used by WhatsApp. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

/** The 24-hour customer service window opens on each inbound message. */
export function serviceWindowEnd(lastInboundAt: Date): Date {
  return new Date(lastInboundAt.getTime() + 24 * 3600 * 1000);
}
