/** Prompt variables, claim helpers and check inputs shared by the stages. */
import { z } from "zod";
import { encode } from "@toon-format/toon";
import type { PlatformCapabilities } from "@platform/types";
import { platformGuidance, withSkillInstructions } from "@platform/ai-core";
import { hashtagLimit, type CheckInput } from "../checks";
import type { AccountStrategy, ClaimRecord, DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";
import { isPipelineBlocked } from "../errors";

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
/**
 * Keeps the playbooks from crowding out the stage prompt itself.
 *
 * Per-skill is the looser of the two on purpose: a playbook that carries its
 * own data (a table of hook formulas, a lexicon) is one coherent document and
 * is worth little in halves. The total is the real guard, so two large
 * playbooks still cannot bury the stage prompt.
 */
/** How much playbook text a stage may carry. Writers need the most; reviewers less. */
export type SkillBudgetRole = "writer" | "review" | "adapt" | "full";

const SKILL_BUDGETS: Record<SkillBudgetRole, { perSkill: number; total: number }> = {
  full: { perSkill: 16_000, total: 24_000 },
  writer: { perSkill: 12_000, total: 18_000 },
  review: { perSkill: 6_000, total: 10_000 },
  adapt: { perSkill: 8_000, total: 12_000 },
};

/**
 * Cuts to a length without leaving the model half a sentence, or worse half a
 * JSON object presented as if whole. Falls back to a hard cut only when there
 * is no line break to fall back to.
 */
function clipAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const lastBreak = head.lastIndexOf("\n");
  const body = lastBreak > limit * 0.5 ? head.slice(0, lastBreak) : head;
  return `${body}\n\n[truncated: this playbook is longer than the prompt allows]`;
}

/**
 * The playbooks a stage must follow for one platform: the run's chosen skills
 * plus every "always" skill, filtered to the platform, in the order they were
 * chosen. Legacy `ctx.skillInstructions` (already rendered) comes first.
 * `role` tightens the char budget so review/adapt do not re-pay writer-sized packs.
 */
export function skillInstructionsFor(
  ctx: PipelineContext,
  run: RunSnapshot,
  platform: string,
  role: SkillBudgetRole = "full",
): string | undefined {
  const budgetLimits = SKILL_BUDGETS[role];
  const cards = ctx.skills ?? [];
  const chosen = run.skillIds ?? [];
  const ordered = [
    ...chosen.flatMap((id) => cards.filter((c) => c.id === id)),
    ...cards.filter((c) => c.always && !chosen.includes(c.id)),
  ].filter((c) => c.platforms.length === 0 || c.platforms.includes(platform));
  const blocks: string[] = ctx.skillInstructions?.trim() ? [ctx.skillInstructions.trim()] : [];
  let budget = budgetLimits.total;
  for (const card of ordered) {
    if (budget <= 0) break;
    const text = clipAtBoundary(card.instructions.trim(), Math.min(budgetLimits.perSkill, budget));
    if (!text) continue;
    blocks.push(`## Skill: ${card.name}\n${text}`);
    budget -= text.length;
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

const SKILL_SUMMARY_INSTRUCTION_CHARS = 400;

/**
 * Short catalogue of the playbooks attached to this run for one platform:
 * name, description, and a ~400-char clip of instructions. Used by the
 * strategist so it can lean on playbooks without loading full SKILL.md bodies.
 * Returns a placeholder when nothing applies.
 */
export function skillSummariesFor(
  ctx: PipelineContext,
  run: RunSnapshot,
  platform: string,
  maxChars = 3_000,
): string {
  const cards = ctx.skills ?? [];
  const chosen = run.skillIds ?? [];
  const ordered = [
    ...chosen.flatMap((id) => cards.filter((c) => c.id === id)),
    ...cards.filter((c) => c.always && !chosen.includes(c.id)),
  ].filter((c) => c.platforms.length === 0 || c.platforms.includes(platform));
  // Match skillInstructionsFor: legacy pre-rendered instructions still reach the strategist.
  const blocks: string[] = [];
  let budget = maxChars;
  if (ctx.skillInstructions?.trim()) {
    const legacy = clipAtBoundary(ctx.skillInstructions.trim(), Math.min(SKILL_SUMMARY_INSTRUCTION_CHARS * 2, budget));
    blocks.push(`- (campaign playbooks)\n  ${legacy.replace(/\n/g, "\n  ")}`);
    budget -= blocks[0]!.length + 2;
  }
  if (ordered.length === 0 && blocks.length === 0) return "(none)";
  for (const card of ordered) {
    if (budget <= 0) break;
    const clip = clipAtBoundary(card.instructions.trim(), SKILL_SUMMARY_INSTRUCTION_CHARS);
    const block = [`- ${card.name}: ${card.description.trim() || "(no description)"}`, clip ? `  ${clip.replace(/\n/g, "\n  ")}` : ""]
      .filter(Boolean)
      .join("\n");
    if (block.length > budget) {
      blocks.push(block.slice(0, budget).trimEnd() + "…");
      break;
    }
    blocks.push(block);
    budget -= block.length + 2;
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "(none)";
}

/**
 * Appends the playbooks for the account's platform to a stage prompt. Without a
 * run the legacy pre-rendered instructions alone apply. Pass `role` to use a
 * tighter excerpt budget (review/adapt) while writers keep the fuller pack.
 */
export function withSkills(
  ctx: PipelineContext,
  system: string,
  run?: RunSnapshot,
  platform?: string,
  role: SkillBudgetRole = "full",
): string {
  const instructions = run && platform ? skillInstructionsFor(ctx, run, platform, role) : ctx.skillInstructions;
  return withSkillInstructions(system, instructions);
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * One line telling the model how to read the block that follows. TOON is close
 * enough to YAML that models handle it unprompted, but naming it costs a dozen
 * tokens and removes the guess.
 */
const TOON_NOTE = "# TOON format: indentation is nesting; [n]{a,b}: heads n rows with those fields.";

/**
 * Context the model reads, encoded as TOON instead of JSON.
 *
 * Measured against this pipeline's own data, TOON costs 24% fewer tokens than
 * pretty JSON for the Account Brain and about 7% for the research brief and the
 * strategy: the saving comes from uniform arrays, which lose their repeated
 * keys, so prose-heavy payloads gain little. It is used only for what the model
 * reads. Everything the model writes stays JSON, where schema validation and
 * the providers' own JSON modes make it far likelier to parse.
 */
export function encodeContext(value: unknown): string {
  return `${TOON_NOTE}
${encode(value)}`;
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

/**
 * Compact claims for seats that only need to check citations (review / judge),
 * not re-read evidence. Writers and strategy still use `claimsText`.
 */
export function claimsIdsText(claims: readonly ClaimRecord[]): string {
  if (claims.length === 0) return "(none)";
  return claims.map((c) => `- [${c.id}] ${c.statement}`).join("\n");
}

/**
 * Shared run context pack: topic, goal, audience, strategy stub, claim ids.
 * Keeps later seats aligned without re-pasting the full research brief.
 */
export function runContextPack(run: RunSnapshot, account?: RunAccountSnapshot): string {
  const claims = supportedClaims(run.claims);
  const strategy = account?.strategy;
  const lines = [
    `Topic: ${run.brief.topic}`,
    `Goal: ${run.brief.goal}`,
    run.brief.audience ? `Audience: ${run.brief.audience}` : null,
    strategy
      ? `Strategy: ${strategy.angle} · hook ${strategy.hookType} · format ${strategy.format}${strategy.cta ? ` · CTA ${strategy.cta}` : ""}`
      : null,
    "Claims:",
    claimsIdsText(claims),
  ];
  return lines.filter((l): l is string => Boolean(l)).join("\n");
}

/** How many drafts get a full platform Lens pass when assurance is Standard. */
export const PLATFORM_REVIEW_TOP_N = 2;

/**
 * Rank drafts for Lens: prefer more cited claims and a sensible length; penalise
 * hashtag spam. Pure — no model call.
 */
export function rankDraftsForReview(drafts: readonly DraftCandidate[]): DraftCandidate[] {
  const score = (d: DraftCandidate) =>
    (d.claimIds?.length ?? 0) * 10 + Math.min(d.text.length, 2_000) / 100 - (d.hashtags.length > 8 ? 5 : 0);
  return [...drafts].sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
}

/**
 * Which survivors get a deep platform review. Thorough assurance reviews all;
 * Standard keeps the top N and lets the rest skip to the judge (still checked).
 */
export function draftsForPlatformReview(
  drafts: readonly DraftCandidate[],
  assurance: string | undefined,
): { deep: DraftCandidate[]; passThrough: DraftCandidate[] } {
  if (assurance === "HIGH_ASSURANCE" || drafts.length <= PLATFORM_REVIEW_TOP_N) {
    return { deep: [...drafts], passThrough: [] };
  }
  const ranked = rankDraftsForReview(drafts);
  return {
    deep: ranked.slice(0, PLATFORM_REVIEW_TOP_N),
    passThrough: ranked.slice(PLATFORM_REVIEW_TOP_N),
  };
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

/** The chosen strategy as prompt text. The other strategists' angles (and which models they came from) stay out of every prompt. */
export function strategyText(strategy: AccountStrategy | undefined): string {
  if (!strategy) return "(no strategy recorded)";
  const { alternatives: _alternatives, ...chosen } = strategy;
  return encodeContext(chosen);
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
    brain: encodeContext(account.profile),
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
/**
 * The accounts of a run, worked at the same time instead of one after another.
 *
 * Each account's strategy, drafts, review and verdict are independent, so a
 * second account used to double the wall clock for no reason. Failure keeps the
 * old meaning: a blocked pipeline stops everything, and any other error still
 * fails the run, it just no longer decides how long the run takes.
 */
export async function perAccount<T>(
  accounts: readonly RunAccountSnapshot[],
  work: (account: RunAccountSnapshot) => Promise<T>,
): Promise<T[]> {
  const settled = await Promise.allSettled(accounts.map((account) => work(account)));
  const blocked = settled.find((r) => r.status === "rejected" && isPipelineBlocked(r.reason));
  if (blocked?.status === "rejected") throw blocked.reason;
  const failed = settled.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return settled.map((r) => (r as PromiseFulfilledResult<T>).value);
}

export function stepName(stage: string, account?: RunAccountSnapshot, detail?: string): string {
  return [stage, account?.runAccountId, detail].filter(Boolean).join(":");
}

export function draftsByRole(account: RunAccountSnapshot, roles: readonly DraftCandidate["role"][]): DraftCandidate[] {
  return account.drafts.filter((d) => roles.includes(d.role));
}
