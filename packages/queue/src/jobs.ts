/** Queue names. One queue per concern so workers can scale independently. */
export const QUEUES = {
  publish: "publish",
  webhooks: "webhooks",
  media: "media",
  whatsapp: "whatsapp-outbound",
  campaigns: "campaigns",
  analytics: "analytics",
  maintenance: "maintenance",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface PublishJobData {
  publishJobId: string;
  postVariantId: string;
  organizationId: string;
}

export interface WebhookJobData {
  webhookEventId: string;
}

export interface MediaJobData {
  mediaAssetId: string;
  organizationId: string;
}

export interface WhatsAppOutboundJobData {
  messageId: string;
  organizationId: string;
}

export interface CampaignJobData {
  campaignId: string;
  organizationId: string;
}

export interface AnalyticsJobData {
  organizationId: string;
  socialAccountId?: string;
  postVariantId?: string;
}

export type MaintenanceJobData =
  { task: "refresh-tokens" } | { task: "expire-oauth-states" } | { task: "retry-stuck-jobs" };

export interface JobDataMap {
  publish: PublishJobData;
  webhooks: WebhookJobData;
  media: MediaJobData;
  "whatsapp-outbound": WhatsAppOutboundJobData;
  campaigns: CampaignJobData;
  analytics: AnalyticsJobData;
  maintenance: MaintenanceJobData;
}
