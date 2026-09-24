/**
 * REVIEWING: deterministic checks first (no model, no cost). Only drafts that
 * fail go through the revision editor, once. Drafts that still fail are dropped
 * — the judge must never see a draft that breaks a rule.
 *
 * Every survivor then gets a platform review: a reader for that platform,
 * armed with the platform conventions and the playbooks attached to the
 * campaign, lists what a person would notice and says whether the draft must
 * be revised. A REVISE verdict triggers one fix pass; the notes travel to the
 * blind judge either way. HIGH_ASSURANCE asks a provider that did not write
 * the draft to do the review.
 */
import { z } from "zod";
import { checkErrors, runChecks } from "../checks";
import type { CheckResult, DraftCandidate, PipelineContext, ReviewNote, RunSnapshot } from "../contracts";
import { errorMessage, isPipelineBlocked, PipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import {
  accountVars,
  checkInputFor,
  claimsText,
  DraftOutputSchema,
  filterClaimIds,
  plannedMedia,
  stepName,
  strategyText,
  supportedClaims,
  withSkills,
  type RunAccountSnapshot,
} from "./shared";

const REVISION_OUTPUT_TOKENS = 1_200;
const REVIEW_OUTPUT_TOKENS = 600;

export const ReviewNotesOutputSchema = z.object({
  verdict: z.enum(["PASS", "REVISE"]).default("PASS"),
  issues: z.array(z.string()).default([]),
});

/** One draft per label: the revision when there is one, otherwise the original. */
export function latestDraftsByLabel(account: RunAccountSnapshot): DraftCandidate[] {
  const byLabel = new Map<string, DraftCandidate>();
  for (const draft of account.drafts) {
    if (draft.role !== "WRITER" && draft.role !== "REVISION") continue;
    const current = byLabel.get(draft.label);
    // Drafts arrive in creation order, so the newest revision of a label wins.
    if (!current || draft.role === "REVISION") byLabel.set(draft.label, draft);
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Drafts a later stage may still use: the newest draft per label that passes
 * the deterministic checks. Checks are pure, so judging and adapting can
 * recompute this from a fresh snapshot instead of trusting stored state.
 */
export function selectCandidates(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
): DraftCandidate[] {
  return latestDraftsByLabel(account).filter(
    (draft) => runChecks(checkInputFor(ctx, run, account, draft, plannedMedia(account))).ok,
  );
}

function checkDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: { text: string; hashtags: string[] },
): CheckResult {
  return runChecks(checkInputFor(ctx, run, account, draft, plannedMedia(account)));
}

/** Issue lines the revision editor reads, from deterministic checks or from a reviewer. */
export function issueLines(result: CheckResult): string[] {
  return result.issues.map((i) => `[${i.severity}] ${i.code}: ${i.message}`);
}

/**
 * One revision pass on a draft. Returns the revised draft when it passes the
 * deterministic checks again, otherwise undefined.
 */
async function reviseDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: DraftCandidate,
  issues: readonly string[],
  suffix: "revision" | "review-fix",
): Promise<DraftCandidate | undefined> {
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("revision", account, suffix === "revision" ? draft.label : `${draft.label}.${suffix}`),
      promptKey: "revision",
      pref: { provider: draft.provider, model: draft.model },
      temperature: 0.3,
      expectedOutputTokens: REVISION_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("revision", {
          ...accountVars(account),
          claims: claimsText(supportedClaims(run.claims)),
          issues: issues.map((i) => `- ${i}`).join("\n"),
          text: draft.text,
          hashtags: draft.hashtags.join(" "),
        }),
        run,
        account.platform,
      ),
      user: "Revise the draft now. Return only the JSON object.",
    },
    DraftOutputSchema,
  );
  const revised: DraftCandidate = {
    ...draft,
    id: undefined,
    role: "REVISION",
    provider: call.provider,
    model: call.model,
    promptKey: call.promptKey,
    promptVersion: call.promptVersion,
    promptHash: call.promptHash,
    text: value.text,
    hashtags: value.hashtags,
    claimIds: filterClaimIds(value.claimIds, run.claims),
    costCents: call.costCents,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    latencyMs: call.latencyMs,
  };
  const recheck = checkDraft(ctx, run, account, revised);
  const id = await ctx.store.saveDraft(run.id, account.runAccountId, revised, { checks: recheck });
  await ctx.store.addEvent(run.id, {
    step: stepName("checks", account, `${draft.label}.${suffix}`),
    status: recheck.ok ? "SUCCEEDED" : "FAILED",
    validation: recheck.issues,
  });
  return recheck.ok ? { ...revised, id } : undefined;
}

interface PlatformReview {
  verdict: "PASS" | "REVISE";
  issues: string[];
}

/**
 * The platform reader's verdict on one draft. HIGH_ASSURANCE prefers a provider
 * that did not write it; otherwise routing decides.
 */
async function reviewDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: DraftCandidate,
): Promise<PlatformReview | undefined> {
  const other =
    run.assurance === "HIGH_ASSURANCE" ? ctx.availableProviders.find((p) => p !== draft.provider) : undefined;
  try {
    const { value } = await callJson(
      ctx,
      {
        runId: run.id,
        organizationId: run.organizationId,
        step: stepName("review", account, draft.label),
        promptKey: "review",
        pref: other ? { provider: other } : undefined,
        temperature: 0.2,
        expectedOutputTokens: REVIEW_OUTPUT_TOKENS,
        system: withSkills(
          ctx,
          renderPrompt("review", {
            ...accountVars(account),
            strategy: strategyText(account.strategy),
            claims: claimsText(supportedClaims(run.claims)),
            text: draft.text,
            hashtags: draft.hashtags.join(" "),
          }),
          run,
          account.platform,
        ),
        user: `Review this draft as a ${account.platform} reader now. Return only the JSON object.`,
      },
      ReviewNotesOutputSchema,
    );
    return { verdict: value.issues.length === 0 ? "PASS" : value.verdict, issues: value.issues };
  } catch (error) {
    if (isPipelineBlocked(error)) throw error;
    await ctx.store.addEvent(run.id, {
      step: stepName("review", account, draft.label),
      status: "SKIPPED",
      error: errorMessage(error),
    });
    return undefined;
  }
}

/**
 * Platform review for every survivor. A REVISE verdict gets one fix pass; when
 * the fix passes the deterministic checks it replaces the draft, otherwise the
 * original stays (it already passed) and the judge sees the notes.
 */
async function platformReview(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  survivors: readonly DraftCandidate[],
): Promise<{ drafts: DraftCandidate[]; notes: ReviewNote[] }> {
  const drafts: DraftCandidate[] = [];
  const notes: ReviewNote[] = [];
  for (const draft of survivors) {
    const review = await reviewDraft(ctx, run, account, draft);
    if (!review) {
      drafts.push(draft);
      continue;
    }
    if (review.issues.length > 0) notes.push({ label: draft.label, issues: review.issues });
    let fixed: DraftCandidate | undefined;
    if (review.verdict === "REVISE") {
      fixed = await reviseDraft(ctx, run, account, draft, review.issues, "review-fix").catch(async (error: unknown) => {
        if (isPipelineBlocked(error)) throw error;
        await ctx.store.addEvent(run.id, {
          step: stepName("revision", account, `${draft.label}.review-fix`),
          status: "SKIPPED",
          error: errorMessage(error),
        });
        return undefined;
      });
    }
    await ctx.store.addEvent(run.id, {
      step: stepName("review", account, draft.label),
      status: "SUCCEEDED",
      output: { verdict: review.verdict, issues: review.issues, fixed: Boolean(fixed) },
    });
    drafts.push(fixed ?? draft);
  }
  return { drafts, notes };
}

async function reviewAccount(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
): Promise<DraftCandidate[]> {
  const survivors: DraftCandidate[] = [];
  for (const draft of latestDraftsByLabel(account)) {
    const result = checkDraft(ctx, run, account, draft);
    await ctx.store.addEvent(run.id, {
      step: stepName("checks", account, draft.label),
      status: result.ok ? "SUCCEEDED" : "FAILED",
      validation: result.issues,
    });
    if (result.ok) {
      survivors.push(draft);
      continue;
    }
    const revised = await reviseDraft(ctx, run, account, draft, issueLines(result), "revision").catch(
      async (error: unknown) => {
        if (isPipelineBlocked(error)) throw error;
        await ctx.store.addEvent(run.id, {
          step: stepName("revision", account, draft.label),
          status: "SKIPPED",
          error: errorMessage(error),
        });
        return undefined;
      },
    );
    if (revised) survivors.push(revised);
    else
      await ctx.store.addEvent(run.id, {
        step: stepName("draft-dropped", account, draft.label),
        status: "SKIPPED",
        error: checkErrors(result)
          .map((i) => i.message)
          .join("; "),
      });
  }
  return survivors;
}

/** REVIEWING: checks, one revision pass, platform review with a fix pass; drops what still fails. */
export async function reviewStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  let survivingTotal = 0;
  for (const account of run.accounts) {
    const survivors = await reviewAccount(ctx, run, account);
    if (survivors.length === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("review", account),
        status: "SKIPPED",
        error: "no draft passed the checks for this account",
      });
      continue;
    }
    const { drafts, notes } = await platformReview(ctx, run, account, survivors);
    survivingTotal += drafts.length;
    await ctx.store.saveReviewNotes(account.runAccountId, notes);
  }
  if (survivingTotal === 0) throw new PipelineBlocked("no valid drafts");
}
