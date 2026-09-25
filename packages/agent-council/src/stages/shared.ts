/** Prompt variables, claim helpers and check inputs shared by the stages. */
import { z } from "zod";
import type { PlatformCapabilities } from "@platform/types";
import { platformGuidance, withSkillInstructions } from "@platform/ai-core";
import { hashtagLimit, type CheckInput } from "../checks";
import type { AccountStrategy, ClaimRecord, DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";

/** Labels handed to the blind judge; also the writer slots. */
export const DRAFT_LABELS = ["A", "B", "C"] as const;

/** Model output shared by writer, revision and synthesis. */
export const DraftOutputSchema = z.object({
  /** The writer's one-line plan; streamed to watchers, never published. */
  plan: z.string().optional(),
  text: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  claimIds: z.array(z.string()).default([]),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

export type RunAccountSnapshot = RunSnapshot["accounts"][number];

/**
 * A stage system prompt with the campaign's attached skill playbooks appended,
 * using the same framing as every other AI call so one skill reads the same way
 * wherever it is applied. Returns the prompt unchanged when nothing is attached.
 */
/** Keeps the playbooks from crowding out the stage prompt itself. */
const SKILL_CHARS_PER_SKILL = 10_000;
const SKILL_CHARS_TOTAL = 24_000;

/**
 * The playbooks a stage must follow for one platform: the run's chosen skills
 * plus every "always" skill, filtered to the platform, in the order they were
 * chosen. Legacy `ctx.skillInstructions` (already rendered) comes first.
 */
export function skillInstructionsFor(ctx: PipelineContext, run: RunSnapshot, platform: string): string | undefined {
  const cards = ctx.skills ?? [];
  const chosen = run.skillIds ?? [];
  const ordered = [
    ...chosen.flatMap((id) => cards.filter((c) => c.id === id)),
    ...cards.filter((c) => c.always && !chosen.includes(c.id)),
  ].filter((c) => c.platforms.length === 0 || c.platforms.includes(platform));
  const blocks: string[] = ctx.skillInstructions?.trim() ? [ctx.skillInstructions.trim()] : [];
  let budget = SKILL_CHARS_TOTAL;
  for (const card of ordered) {
    if (budget <= 0) break;
    const text = card.instructions.trim().slice(0, Math.min(SKILL_CHARS_PER_SKILL, budget));
    if (!text) continue;
    blocks.push(`## Skill: ${card.name}\n${text}`);
    budget -= text.length;
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/**
 * Appends the playbooks for the account's platform to a stage prompt. Without a
 * run the legacy pre-rendered instructions alone apply.
 */
export function withSkills(ctx: PipelineContext, system: string, run?: RunSnapshot, platform?: string): string {
  const instructions = run && platform ? skillInstructionsFor(ctx, run, platform) : ctx.skillInstructions;
  return withSkillInstructions(system, instructions);
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Readable, id-first rendering so the model can cite claims by id. */
export function claimsText(claims: readonly ClaimRecord[]): string {
  if (claims.length === 0) return "(none)";
  return claims
    .map(
      (c) =>
        `- [${c.id}] ${c.statement} (status ${c.status}, confidence ${c.confidence}${
          c.sourceUrl ? `, source ${c.sourceUrl}` : ""
        })`,
    )
    .join("\n");
}

export function supportedClaims(claims: readonly ClaimRecord[]): ClaimRecord[] {
  return claims.filter((c) => c.status === "SUPPORTED");
}

/** Only SUPPORTED claim ids may travel with a draft. */
export function filterClaimIds(ids: readonly string[], claims: readonly ClaimRecord[]): string[] {
  const allowed = new Set(supportedClaims(claims).map((c) => c.id));
  return [...new Set(ids)].filter((id) => allowed.has(id));
}

export function capabilitiesText(capabilities: PlatformCapabilities): string {
  const media = capabilities.media;
  return [
    `text up to ${capabilities.text.maxLength} characters`,
    `media ${media.required ? "required" : "optional"} (${media.kinds.join(", ") || "none"}, max ${media.maxCount})`,
    capabilities.supportsCarousel ? "carousel supported" : "no carousel",
    capabilities.supportsHashtags ? "hashtags supported" : "no hashtags",
    capabilities.supportsLinkPreview ? "link previews" : "no link previews",
  ].join("; ");
}

export function strategyText(strategy: AccountStrategy | undefined): string {
  return strategy ? stringify(strategy) : "(no strategy recorded)";
}

/**
 * Models sometimes cite a claim inside the post ("… 70% [cl_3]") although ids
 * belong only in `claimIds`. Remove every known claim id, with any brackets
 * or parentheses around it, and tidy the whitespace left behind.
 */
export function stripInlineClaimIds(text: string, claims: readonly { id: string }[]): string {
  if (claims.length === 0) return text;
  const ids = claims.map((c) => c.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const grouped = new RegExp(`\\s*[\\[(]\\s*(?:${ids})(?:\\s*[,;/]\\s*(?:${ids}))*\\s*[\\])]`, "g");
  const bare = new RegExp(`\\s*\\b(?:${ids})\\b`, "g");
  return text
    .replace(grouped, "")
    .replace(bare, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Prompt variables every per-account prompt shares. */
export function accountVars(account: RunAccountSnapshot): Record<string, string | number> {
  const limit = hashtagLimit(account.platform);
  return {
    platform: account.platform,
    accountType: account.accountType,
    displayName: account.displayName,
    capabilities: capabilitiesText(account.capabilities),
    platformGuidance: platformGuidance({
      platform: account.platform,
      maxLength: account.capabilities.text.maxLength,
      supportsHashtags: account.capabilities.supportsHashtags,
    }),
    maxLength: account.capabilities.text.maxLength,
    maxHashtags: limit.max,
    hashtagNote: limit.severity === "warning" ? ` (${limit.max} is a recommendation, fewer is better)` : "",
    brain: stringify(account.profile),
  };
}

/** Recently published texts for the duplicate check (snapshot first, context as fallback). */
export function recentTexts(ctx: PipelineContext, run: RunSnapshot): string[] {
  return run.recentTexts ?? ctx.recentTexts ?? [];
}

export function checkInputFor(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  post: { text: string; hashtags: string[] },
  hasMedia: boolean,
): CheckInput {
  return {
    text: post.text,
    hashtags: post.hashtags,
    platform: account.platform,
    capabilities: account.capabilities,
    claims: run.claims,
    brief: run.brief,
    research: run.research,
    brain: account.profile,
    recentTexts: recentTexts(ctx, run),
    hasMedia,
  };
}

/** Whether the post will ship with media: the strategy or an adaptation proposed a concept. */
export function plannedMedia(account: RunAccountSnapshot, mediaConcept?: string): boolean {
  return Boolean(mediaConcept ?? account.strategy?.mediaConcept);
}

/** Replay step name; per-account steps carry the account id (events have no account column). */
export function stepName(stage: string, account?: RunAccountSnapshot, detail?: string): string {
  return [stage, account?.runAccountId, detail].filter(Boolean).join(":");
}

export function draftsByRole(account: RunAccountSnapshot, roles: readonly DraftCandidate["role"][]): DraftCandidate[] {
  return account.drafts.filter((d) => roles.includes(d.role));
}
