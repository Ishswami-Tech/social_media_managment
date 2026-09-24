/**
 * Expected-performance estimate for a finished post.
 *
 * Deterministic and explainable: platform conventions everyone can verify
 * (hook length, rhythm, length band, hashtags, CTA) blended with what the
 * account's own history says works (Account Brain `performance`, learned with
 * sample-size gating) and, when present, the blind judge's rubric score. It is
 * an estimate that helps a person choose and edit, not a promise of reach; the
 * label says so and every point is backed by a reason they can read.
 */
import type { AccountBrain } from "./contracts";

export type PerformanceBand = "low" | "fair" | "good" | "strong";

export interface PerformanceEstimate {
  /** 0-100. */
  score: number;
  band: PerformanceBand;
  /** What helped, in the order it counted. */
  strengths: string[];
  /** What is holding the post back, most costly first. */
  improvements: string[];
  /** How much of the estimate rests on this account's own history (0-1). */
  historyWeight: number;
}

export interface PerformanceInput {
  text: string;
  hashtags: readonly string[];
  platform: string;
  brain?: AccountBrain;
  /** Blind judge total (0-60) when the run had one. */
  judgeScore?: number | null;
  /** Hook and CTA the strategy asked for, to reward alignment. */
  strategy?: { hookType?: string; cta?: string } | null;
}

interface LengthBand {
  min: number;
  max: number;
  hardMax: number;
}

/** Character bands where posts tend to hold attention, per platform. */
const LENGTH_BANDS: Record<string, LengthBand> = {
  LINKEDIN: { min: 600, max: 1_800, hardMax: 3_000 },
  FACEBOOK: { min: 80, max: 600, hardMax: 63_206 },
  INSTAGRAM: { min: 120, max: 1_200, hardMax: 2_200 },
  THREADS: { min: 60, max: 400, hardMax: 500 },
  X: { min: 60, max: 260, hardMax: 280 },
  TIKTOK: { min: 40, max: 300, hardMax: 2_200 },
  YOUTUBE: { min: 200, max: 3_000, hardMax: 5_000 },
  PINTEREST: { min: 80, max: 400, hardMax: 500 },
};
const DEFAULT_BAND: LengthBand = { min: 100, max: 1_200, hardMax: 3_000 };

/** Hashtag counts that read as native, per platform (inclusive). */
const HASHTAG_SWEET_SPOT: Record<string, [number, number]> = {
  LINKEDIN: [0, 3],
  INSTAGRAM: [3, 10],
  FACEBOOK: [0, 2],
  THREADS: [0, 2],
  X: [0, 1],
  TIKTOK: [2, 5],
  YOUTUBE: [0, 3],
  PINTEREST: [2, 6],
};

const HOOK_MAX_CHARS = 200;
const HOOK_IDEAL_CHARS = 120;
const PARAGRAPH_MAX_CHARS = 320;
const JUDGE_MAX = 60;
const CLICHES = [
  "game-changer",
  "game changer",
  "in today's fast-paced world",
  "unlock",
  "delve",
  "elevate",
  "revolutionize",
  "synergy",
  "leverage",
  "cutting-edge",
  "excited to announce",
  "thrilled to share",
  "🚀",
];

export interface TextSignals {
  hookType: "question" | "number" | "story" | "statement";
  hookLength: number;
  paragraphs: number;
  longestParagraph: number;
  length: number;
  ctaType: "question" | "comment" | "link" | "none";
  cliches: string[];
  emojiCount: number;
}

const STORY_RE =
  /\b(i remember|last (week|month|year|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|when i|years? ago|my (first|story|journey)|once upon|yesterday|this morning)\b/i;
const NUMBER_RE = /(^|\s)[$€£₹]?\d[\d,.]*%?/;
const COMMENT_CTA_RE = /\b(comment|reply|tell me|drop|share (your|below)|let me know|what('s| is) your)\b/i;
const LINK_CTA_RE = /\b(link in bio|click|sign up|register|download|book a|visit|learn more)\b|https?:\/\//i;

/** Plain features of a post text, computed the same way for every platform. */
export function textSignals(text: string): TextSignals {
  const trimmed = text.trim();
  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const first = (trimmed.split(/\n/)[0] ?? "").trim();
  const lastParagraph = paragraphs[paragraphs.length - 1] ?? "";
  // A story that happens to contain a number is still a story.
  const hookType: TextSignals["hookType"] = /\?\s*$/.test(first)
    ? "question"
    : STORY_RE.test(first)
      ? "story"
      : NUMBER_RE.test(first)
        ? "number"
        : "statement";
  const ctaType: TextSignals["ctaType"] = LINK_CTA_RE.test(lastParagraph)
    ? "link"
    : /\?\s*$/.test(lastParagraph)
      ? "question"
      : COMMENT_CTA_RE.test(lastParagraph)
        ? "comment"
        : "none";
  const lower = trimmed.toLowerCase();
  return {
    hookType,
    hookLength: first.length,
    paragraphs: paragraphs.length,
    longestParagraph: paragraphs.reduce((max, p) => Math.max(max, p.length), 0),
    length: trimmed.length,
    ctaType,
    cliches: CLICHES.filter((c) => lower.includes(c)),
    emojiCount: (trimmed.match(/\p{Extended_Pictographic}/gu) ?? []).length,
  };
}

function bandOf(score: number): PerformanceBand {
  if (score >= 80) return "strong";
  if (score >= 62) return "good";
  if (score >= 42) return "fair";
  return "low";
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

interface Scorer {
  points: number;
  strengths: string[];
  improvements: string[];
}

function scoreHook(s: TextSignals, input: PerformanceInput, out: Scorer): void {
  const learned = input.brain?.performance?.bestHooks ?? [];
  if (s.hookLength === 0) {
    out.improvements.push("The post has no first line to stop a scroll");
    return;
  }
  if (s.hookLength <= HOOK_IDEAL_CHARS) {
    out.points += 12;
    out.strengths.push("Short first line that survives the fold");
  } else if (s.hookLength <= HOOK_MAX_CHARS) {
    out.points += 7;
  } else {
    out.improvements.push(`First line is ${s.hookLength} characters; readers see about ${HOOK_MAX_CHARS} before "see more"`);
  }
  if (learned.includes(s.hookType)) {
    out.points += 10;
    out.strengths.push(`Opens with a ${s.hookType} hook, which has worked for this account`);
  } else if (input.strategy?.hookType && input.strategy.hookType.toLowerCase() === s.hookType) {
    out.points += 6;
    out.strengths.push(`Opens with the ${s.hookType} hook the strategy asked for`);
  } else if (s.hookType === "statement" && learned.length > 0) {
    out.improvements.push(`Opens with a plain statement; ${learned.join(" or ")} hooks have done better here`);
  } else {
    out.points += 4;
  }
}

function scoreReadability(s: TextSignals, platform: string, out: Scorer): void {
  const band = LENGTH_BANDS[platform] ?? DEFAULT_BAND;
  if (s.length >= band.min && s.length <= band.max) {
    out.points += 12;
    out.strengths.push("Length sits in the band that holds attention on this platform");
  } else if (s.length < band.min) {
    out.points += 5;
    out.improvements.push(`Only ${s.length} characters; posts under ${band.min} rarely earn a stop on ${platformWord(platform)}`);
  } else if (s.length <= band.hardMax) {
    out.points += 5;
    out.improvements.push(`${s.length} characters is long for ${platformWord(platform)}; cutting toward ${band.max} usually lifts completion`);
  } else {
    out.improvements.push(`Over the ${band.hardMax}-character limit`);
  }
  if (s.longestParagraph <= PARAGRAPH_MAX_CHARS && s.paragraphs > 1) {
    out.points += 10;
    out.strengths.push("Short paragraphs that read well on a phone");
  } else if (s.paragraphs <= 1 && s.length > PARAGRAPH_MAX_CHARS) {
    out.improvements.push("One block of text; line breaks between ideas make it readable on a phone");
  } else if (s.longestParagraph > PARAGRAPH_MAX_CHARS) {
    out.points += 4;
    out.improvements.push("At least one paragraph is a wall of text; split it");
  } else {
    out.points += 6;
  }
}

function scoreCta(s: TextSignals, input: PerformanceInput, out: Scorer): void {
  const learned = input.brain?.performance?.bestCtas ?? [];
  if (s.ctaType === "none") {
    out.improvements.push("No clear call to action at the end; a question or an invitation to comment lifts replies");
    return;
  }
  if (learned.includes(s.ctaType)) {
    out.points += 12;
    out.strengths.push(`Ends with a ${s.ctaType} call to action, the kind that has worked for this account`);
  } else if (s.ctaType === "question" || s.ctaType === "comment") {
    out.points += 9;
    out.strengths.push("Ends with an invitation to reply");
  } else {
    out.points += 5;
    out.improvements.push("Link calls to action get fewer replies than a question; consider moving the link to the first comment");
  }
}

function scoreHashtags(hashtags: readonly string[], platform: string, out: Scorer): void {
  const [min, max] = HASHTAG_SWEET_SPOT[platform] ?? [0, 5];
  const n = hashtags.length;
  if (n >= min && n <= max) {
    out.points += 8;
  } else if (n > max) {
    out.points += 2;
    out.improvements.push(`${n} hashtags; ${max} or fewer reads as native on ${platformWord(platform)}`);
  } else {
    out.points += 4;
    out.improvements.push(`Add ${min - n} more relevant hashtag${min - n === 1 ? "" : "s"} for discovery on ${platformWord(platform)}`);
  }
}

function scoreVoice(s: TextSignals, input: PerformanceInput, out: Scorer): void {
  const forbidden = (input.brain?.voice?.forbiddenLanguage ?? []).map((w) => w.toLowerCase());
  const lower = input.text.toLowerCase();
  const hits = forbidden.filter((w) => w && lower.includes(w));
  if (s.cliches.length === 0 && hits.length === 0) {
    out.points += 10;
    out.strengths.push("No clichés or forbidden phrases");
  } else {
    const all = [...new Set([...s.cliches, ...hits])];
    out.points += Math.max(0, 10 - 4 * all.length);
    out.improvements.push(`Reads as generic: ${all.map((c) => `"${c}"`).join(", ")}`);
  }
  if (s.emojiCount > 6) out.improvements.push(`${s.emojiCount} emojis is a lot for ${platformWord(input.platform)}`);
}

function platformWord(platform: string): string {
  const lower = platform.toLowerCase();
  return lower === "linkedin" ? "LinkedIn" : lower === "x" ? "X" : lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Heuristics score 0-64 points; the judge (when present) supplies the rest.
 * Without a judge the heuristics are scaled to the full range.
 */
const HEURISTIC_MAX = 64;
const JUDGE_WEIGHT = 36;

export function estimatePerformance(input: PerformanceInput): PerformanceEstimate {
  const s = textSignals(input.text);
  const out: Scorer = { points: 0, strengths: [], improvements: [] };
  scoreHook(s, input, out);
  scoreReadability(s, input.platform, out);
  scoreCta(s, input, out);
  scoreHashtags(input.hashtags, input.platform, out);
  scoreVoice(s, input, out);

  const heuristics = clamp(out.points, 0, HEURISTIC_MAX);
  const judge = typeof input.judgeScore === "number" ? clamp(input.judgeScore / JUDGE_MAX, 0, 1) : undefined;
  const score = Math.round(
    judge === undefined ? (heuristics / HEURISTIC_MAX) * 100 : heuristics + judge * JUDGE_WEIGHT,
  );
  if (judge !== undefined) {
    if (judge >= 0.75) out.strengths.push("The blind judge rated it strongly against the other drafts");
    else if (judge < 0.5) out.improvements.push("The blind judge rated it below the other drafts");
  }
  const sample = input.brain?.performance?.sampleSize ?? 0;
  const confidence = input.brain?.performance?.confidence ?? 0;
  const historyWeight = sample > 0 ? clamp(confidence, 0, 1) : 0;
  return { score: clamp(score, 0, 100), band: bandOf(score), strengths: out.strengths, improvements: out.improvements, historyWeight };
}

export const BAND_LABELS: Record<PerformanceBand, string> = {
  low: "Low",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};
