import type { CampaignBrief } from "../contracts";
import type { Brief } from "@platform/research";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "have", "are", "you", "your", "our", "will", "just",
  "here", "than", "then", "them", "they", "their", "there", "about", "into", "over", "more", "most", "some",
  "were", "been", "being", "what", "when", "which", "while", "also", "only", "very", "each", "every", "study",
  "studies", "report", "reports", "research", "shows", "show", "found", "according", "percent",
]);

/** Lowercase word tokens (letters/digits, length ≥ 2). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

/** Tokens that carry meaning for claim matching: ≥ 4 chars and not a stopword, or any number. */
export function significantTokens(text: string): Set<string> {
  return new Set(tokenize(text).filter((t) => /^\d/.test(t) || (t.length >= 4 && !STOPWORDS.has(t))));
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const shared = [...setA].filter((t) => setB.has(t)).length;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Sentence-ish split (periods, exclamation, question marks, line breaks). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Everything a human wrote or the research produced: allowed context for URLs, numbers and PII. */
export function briefText(brief: CampaignBrief, research?: Brief): string {
  const parts = [brief.topic, brief.goal, brief.audience ?? "", brief.notes ?? ""];
  if (research) {
    parts.push(research.title, research.summary, ...research.keyPoints, ...research.caveats);
    parts.push(...research.sources.flatMap((s) => [s.title, s.url, s.note ?? ""]));
  }
  return parts.join("\n");
}

export function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/[.,;:!?)\]]+$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function extractHashtags(text: string): string[] {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.trim());
}

export function normalizeHashtag(tag: string): string {
  const cleaned = tag.trim().replace(/^#+/, "");
  return `#${cleaned.toLowerCase()}`;
}
