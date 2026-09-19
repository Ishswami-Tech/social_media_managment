export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_TYPES = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "AUDIO",
  "DOCUMENT",
  "STICKER",
  "LOCATION",
  "CONTACTS",
  "TEMPLATE",
  "INTERACTIVE",
  "REACTION",
  "UNKNOWN",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const CONVERSATION_STATUSES = ["OPEN", "PENDING", "RESOLVED", "ARCHIVED"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const TEMPLATE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
