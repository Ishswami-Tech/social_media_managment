/** Prompt variables, claim helpers and check inputs shared by the stages. */
import { z } from "zod";
import type { PlatformCapabilities } from "@platform/types";
import { platformGuidance } from "@platform/ai-core";
import { hashtagLimit, type CheckInput } from "../checks";
import type { AccountStrategy, ClaimRecord, DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";

/** Labels handed to the blind judge; also the writer slots. */
export const DRAFT_LABELS = ["A", "B", "C"] as const;

/** Model output shared by writer, revision and synthesis. */
export const DraftOutputSchema = z.object({
  text: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  claimIds: z.array(z.string()).default([]),
});
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

export type RunAccountSnapshot = RunSnapshot["accounts"][number];

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
