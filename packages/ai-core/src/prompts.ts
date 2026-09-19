import type { GenerationTarget } from "./types";

export interface BrandContext {
  name?: string;
  industry?: string;
  audience?: string;
  tone?: string;
  language?: string;
  rules?: { do?: string[]; dont?: string[]; bannedPhrases?: string[] };
  voiceExamples?: string[];
  /** Retrieved knowledge snippets (RAG) */
  knowledge?: string[];
}

export function brandSystemPrompt(brand?: BrandContext): string {
  const lines: string[] = [
    "You are a senior social media copywriter working inside a publishing platform.",
    "Write natural, specific, non-generic copy. Never invent facts, statistics, offers or quotes.",
    "Never include placeholder text like [Company] or lorem ipsum. Never mention that you are an AI.",
  ];
  if (!brand) return lines.join("\n");
  if (brand.name) lines.push(`Brand: ${brand.name}${brand.industry ? ` (${brand.industry})` : ""}.`);
  if (brand.audience) lines.push(`Audience: ${brand.audience}.`);
  if (brand.tone) lines.push(`Tone of voice: ${brand.tone}.`);
  if (brand.language) lines.push(`Write in language code: ${brand.language}.`);
  if (brand.rules?.do?.length) lines.push(`Always: ${brand.rules.do.join("; ")}.`);
  if (brand.rules?.dont?.length) lines.push(`Never: ${brand.rules.dont.join("; ")}.`);
  if (brand.rules?.bannedPhrases?.length)
    lines.push(`Banned phrases (never use): ${brand.rules.bannedPhrases.join(", ")}.`);
  if (brand.voiceExamples?.length) {
    lines.push("Examples of the brand voice (match style, do not copy):");
    for (const ex of brand.voiceExamples.slice(0, 5)) lines.push(`---\n${ex}`);
  }
  if (brand.knowledge?.length) {
    lines.push("Relevant brand knowledge (use only if relevant, do not fabricate beyond it):");
    for (const k of brand.knowledge.slice(0, 8)) lines.push(`- ${k}`);
  }
  return lines.join("\n");
}

export function platformGuidance(target: GenerationTarget): string {
  const base = `Target platform: ${target.platform}. Hard limit: ${target.maxLength} characters.`;
  switch (target.platform) {
    case "LINKEDIN":
      return `${base} Professional but human. Strong first line (it is truncated after ~200 chars). Short paragraphs, line breaks, 3-5 hashtags at the end. No emojis overload.`;
    case "INSTAGRAM":
      return `${base} Conversational, visual-first caption. Hook in the first sentence. Up to 10 relevant hashtags, placed at the end. Emojis are welcome but purposeful.`;
    case "FACEBOOK":
      return `${base} Friendly, community tone. 1-3 short paragraphs. Ask a question or invite comments. Few or no hashtags.`;
    case "X":
      return `${base} Punchy, one idea. No hashtags unless essential. Under 280 characters.`;
    case "TIKTOK":
      return `${base} Casual, trend-aware caption for a short video. 3-5 hashtags.`;
    case "YOUTUBE":
      return `${base} Write a video title (under 100 chars) followed by a description with a clear first two lines.`;
    default:
      return `${base}${target.supportsHashtags ? " Hashtags allowed." : " Do not use hashtags."}`;
  }
}

export const JSON_INSTRUCTION =
  "Respond with ONLY a valid JSON object matching the requested shape. No markdown fences, no commentary.";
