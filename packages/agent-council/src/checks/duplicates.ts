import { issue, type CheckInput } from "./types";
import { jaccard, tokenize } from "./text-utils";

export const DUPLICATE_THRESHOLD = 0.8;

/** Highest Jaccard similarity between the text and any recent published text. */
export function maxSimilarity(text: string, recentTexts: string[]): number {
  const tokens = tokenize(text);
  return recentTexts.reduce((best, recent) => Math.max(best, jaccard(tokens, tokenize(recent))), 0);
}

export const duplicatesCheck = (input: CheckInput) => {
  if (input.recentTexts.length === 0) return [];
  const similarity = maxSimilarity(input.text, input.recentTexts);
  if (similarity >= DUPLICATE_THRESHOLD) {
    return [issue("duplicate", `Post is ${(similarity * 100).toFixed(0)}% similar to a recently published post`)];
  }
  return [];
};
