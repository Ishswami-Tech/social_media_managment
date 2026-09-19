/**
 * Social publishing platforms. WhatsApp is intentionally excluded: it is a
 * messaging/CRM channel (see ./whatsapp.ts), not a post feed.
 */
export const PLATFORMS = [
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "X",
  "TIKTOK",
  "YOUTUBE",
  "THREADS",
  "PINTEREST",
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Which OAuth provider family owns a platform's authorization flow. */
export const PROVIDER_FAMILIES = ["LINKEDIN", "META", "X", "TIKTOK", "GOOGLE"] as const;
export type ProviderFamily = (typeof PROVIDER_FAMILIES)[number];

export const PLATFORM_FAMILY: Record<Platform, ProviderFamily> = {
  LINKEDIN: "LINKEDIN",
  FACEBOOK: "META",
  INSTAGRAM: "META",
  THREADS: "META",
  X: "X",
  TIKTOK: "TIKTOK",
  YOUTUBE: "GOOGLE",
  PINTEREST: "X", // placeholder until a Pinterest adapter exists; never assumed by core code
};

export const ACCOUNT_TYPES = ["PROFILE", "PAGE", "ORGANIZATION", "CHANNEL", "BUSINESS"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = ["CONNECTED", "EXPIRED", "DISCONNECTED", "ERROR"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const MEDIA_KINDS = ["IMAGE", "VIDEO", "DOCUMENT", "GIF"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface PlatformCapabilities {
  text: { maxLength: number };
  media: {
    kinds: MediaKind[];
    maxCount: number;
    maxImageBytes?: number;
    maxVideoBytes?: number;
    maxVideoSeconds?: number;
    /** Some platforms (Instagram) require at least one media item. */
    required: boolean;
  };
  supportsCarousel: boolean;
  supportsScheduling: boolean; // native scheduling on the provider side
  supportsLinkPreview: boolean;
  supportsHashtags: boolean;
  supportsFirstComment: boolean;
}
