import { describe, expect, it } from "vitest";
import { messagePreview, normalizePhone, parseWhatsAppWebhook, serviceWindowEnd } from "../src/index";

const envelope = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550001111", phone_number_id: "PN1" },
            contacts: [{ profile: { name: "Ada" }, wa_id: "447700900123" }],
            messages: [
              {
                from: "447700900123",
                id: "wamid.1",
                timestamp: "1700000000",
                type: "text",
                text: { body: "Hello there" },
              },
              {
                from: "447700900123",
                id: "wamid.2",
                timestamp: "1700000001",
                type: "image",
                image: { id: "media9", mime_type: "image/jpeg", caption: "pic" },
                context: { id: "wamid.0" },
              },
              {
                from: "447700900123",
                id: "wamid.3",
                timestamp: "1700000002",
                type: "weird_new_type",
                weird_new_type: {},
              },
            ],
            statuses: [
              { id: "wamid.out1", status: "delivered", timestamp: "1700000005", recipient_id: "447700900123" },
              {
                id: "wamid.out2",
                status: "failed",
                timestamp: "1700000006",
                recipient_id: "447700900123",
                errors: [{ code: 131047, title: "Re-engagement", message: "Outside window" }],
              },
            ],
          },
        },
        {
          field: "message_template_status_update",
          value: {
            event: "APPROVED",
            message_template_id: 123,
            message_template_name: "welcome",
            message_template_language: "en_US",
          },
        },
      ],
    },
  ],
};

describe("parseWhatsAppWebhook", () => {
  it("flattens messages, statuses and template updates", () => {
    const events = parseWhatsAppWebhook(envelope);
    expect(events.map((e) => e.kind)).toEqual(["message", "message", "message", "status", "status", "template_status"]);
    const first = events[0];
    expect(first).toMatchObject({
      kind: "message",
      from: "447700900123",
      contactName: "Ada",
      type: "TEXT",
      content: { text: "Hello there" },
      phoneNumberId: "PN1",
    });
    expect(events[1]).toMatchObject({
      type: "IMAGE",
      content: { mediaId: "media9", caption: "pic" },
      replyToMessageId: "wamid.0",
    });
    expect(events[2]).toMatchObject({ type: "UNKNOWN" });
    expect(events[3]).toMatchObject({ kind: "status", status: "DELIVERED", externalMessageId: "wamid.out1" });
    expect(events[4]).toMatchObject({
      kind: "status",
      status: "FAILED",
      errorCode: "131047",
      errorMessage: "Outside window",
    });
    expect(events[5]).toMatchObject({ kind: "template_status", name: "welcome", status: "APPROVED" });
  });
  it("ignores non-WhatsApp envelopes", () => {
    expect(parseWhatsAppWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(parseWhatsAppWebhook(null)).toEqual([]);
  });
});

describe("helpers", () => {
  it("normalises phones", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("447700900123");
    expect(normalizePhone("(555) 000-1111")).toBe("5550001111");
  });
  it("computes the 24h window", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(serviceWindowEnd(t).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
  it("previews", () => {
    expect(messagePreview("TEXT", { text: "hi" })).toBe("hi");
    expect(messagePreview("AUDIO", {})).toBe("[audio]");
  });
});
