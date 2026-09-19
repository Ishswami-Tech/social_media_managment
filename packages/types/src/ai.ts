export const AI_PROVIDERS = ["OPENAI", "ANTHROPIC", "GOOGLE"] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

export const AI_OPERATIONS = [
  "GENERATE",
  "REWRITE",
  "SHORTEN",
  "EXPAND",
  "TRANSLATE",
  "HASHTAGS",
  "HOOKS",
  "CTA",
  "REPURPOSE",
  "PLATFORM_ADAPT",
  "CALENDAR",
  "IMAGE",
  "VISION",
  "QUALITY_CHECK",
  "REPLY_SUGGEST",
  "EMBED",
] as const;
export type AIOperation = (typeof AI_OPERATIONS)[number];

export const AI_CAPABILITIES = ["text", "image", "vision", "embedding", "json"] as const;
export type AICapability = (typeof AI_CAPABILITIES)[number];
