import { issue, type CheckInput } from "./types";
import { normalizeHashtag } from "./text-utils";

/** Characters the post will occupy: text plus any hashtags not already inside it. */
export function effectiveLength(text: string, hashtags: string[]): number {
  const lower = text.toLowerCase();
  const missing = hashtags.map(normalizeHashtag).filter((h) => !lower.includes(h));
  return text.length + (missing.length ? 1 + missing.join(" ").length : 0);
}

export const lengthCheck = (input: CheckInput) => {
  const max = input.capabilities.text.maxLength;
  const length = effectiveLength(input.text, input.hashtags);
  if (length > max) return [issue("length", `Post is ${length} characters; ${input.platform} allows ${max}`)];
  if (input.text.trim().length === 0) return [issue("empty", "Post text is empty")];
  return [];
};
