import type { Platform } from "@platform/types";
import { issue, type CheckInput } from "./types";
import { extractHashtags, normalizeHashtag } from "./text-utils";

export const HASHTAG_LIMITS: Partial<Record<Platform, { max: number; severity: "error" | "warning" }>> = {
  INSTAGRAM: { max: 30, severity: "error" },
  LINKEDIN: { max: 5, severity: "warning" },
};
export const DEFAULT_HASHTAG_LIMIT = 10;

export function hashtagLimit(platform: Platform): { max: number; severity: "error" | "warning" } {
  return HASHTAG_LIMITS[platform] ?? { max: DEFAULT_HASHTAG_LIMIT, severity: "error" };
}

/** Distinct hashtags across the explicit list and the text. */
export function allHashtags(text: string, hashtags: string[]): string[] {
  return [...new Set([...hashtags, ...extractHashtags(text)].map(normalizeHashtag))];
}

export const hashtagsCheck = (input: CheckInput) => {
  const count = allHashtags(input.text, input.hashtags).length;
  if (count > 0 && !input.capabilities.supportsHashtags) {
    return [issue("hashtags_unsupported", `${input.platform} does not support hashtags`, "warning")];
  }
  const limit = hashtagLimit(input.platform);
  if (count > limit.max) {
    return [issue("hashtags_limit", `${count} hashtags; ${input.platform} allows ${limit.max}`, limit.severity)];
  }
  return [];
};
