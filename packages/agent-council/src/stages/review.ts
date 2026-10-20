/**
 * REVIEWING: deterministic checks first (no model, no cost). Only drafts that
 * fail go through the revision editor, once. Drafts that still fail are dropped
 * — the judge must never see a draft that breaks a rule.
 *
 * Survivors then get a platform review. On Standard assurance only the top N
 * drafts (by claims / length) get a deep Lens pass; the rest skip to the judge
 * already checked. HIGH_ASSURANCE reviews every survivor and prefers a provider
 * that did not write the draft. A REVISE verdict triggers one fix pass.
 */
import { z } from "zod";
import { checkErrors, runChecks } from "../checks";
import type { CheckResult, DraftCandidate, PipelineContext, ReviewNote, RunSnapshot } from "../contracts";
import { errorMessage, isPipelineBlocked, PipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import { council, councilPrefs, recordSeatFailure, seatPerspective, seatStep, stageCouncilSize, uniqueStrings, withPerspective } from "./council";
import {
  accountVars,
  checkInputFor,
  claimsIdsText,
  claimsText,
  DraftOutputSchema,
  draftsForPlatformReview,
  filterClaimIds,
  perAccount,
  plannedMedia,
  stepName,
  strategyText,
  stripInlineClaimIds,
  supportedClaims,
  type RunAccountSnapshot,
  withSkills,
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
      live: { label: draft.label, runAccountId: account.runAccountId, field: "text" },
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
        "writer",
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
    text: stripInlineClaimIds(value.text, run.claims),
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

const MAX_POOLED_ISSUES = 8;

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
    const prefs = await councilPrefs(
      ctx,
      new Set([`${draft.provider}::${draft.model}`]),
      stageCouncilSize(ctx, "review", { assurance: run.assurance }),
    );
    const readings = await council(prefs, (pref, index, others) =>
      callJson(
      ctx,
      {
        runId: run.id,
        organizationId: run.organizationId,
        step: seatStep(stepName("review", account, draft.label), index, prefs.length),
        live: { runAccountId: account.runAccountId, field: "verdict" },
        promptKey: "review",
        pref: prefs.length > 1 ? pref : other ? { provider: other } : undefined,
        avoidModels: [`${draft.provider}::${draft.model}`, ...others],
        temperature: 0.2,
        expectedOutputTokens: REVIEW_OUTPUT_TOKENS,
        system: withSkills(
          ctx,
          renderPrompt("review", {
            ...accountVars(account),
            strategy: strategyText(account.strategy),
            claims: claimsIdsText(supportedClaims(run.claims)),
            text: draft.text,
            hashtags: draft.hashtags.join(" "),
          }),
          run,
          account.platform,
          "review",
        ),
        user: withPerspective(`Review this draft as a ${account.platform} reader now. Return only the JSON object.`, seatPerspective("review", index, prefs.length)),
      },
      ReviewNotesOutputSchema,
      ),
      recordSeatFailure(ctx, run.id, stepName("review", account, draft.label), prefs.length),
    );
    // Any reader asking for a revision gets one; every distinct note is kept.
    const issues = uniqueStrings(readings.flatMap((r) => r.value.issues)).slice(0, MAX_POOLED_ISSUES);
    const revise = readings.some((r) => r.value.verdict === "REVISE" && r.value.issues.length > 0);
    return { verdict: issues.length === 0 ? "PASS" : revise ? "REVISE" : "PASS", issues };
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
 * Platform review for survivors. On Standard assurance only the top N drafts
 * get a deep Lens pass (token saver); the rest stay checked and go to the judge.
 * Thorough assurance still reviews every survivor.
 */
async function platformReview(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  survivors: readonly DraftCandidate[],
): Promise<{ drafts: DraftCandidate[]; notes: ReviewNote[] }> {
  const { deep, passThrough } = draftsForPlatformReview(survivors, run.assurance);
  // Pass-through drafts already passed deterministic checks; missing ReviewNotes
  // is not a quality signal for the judge — only that Lens was deferred to save tokens.
  for (const draft of passThrough) {
    await ctx.store.addEvent(run.id, {
      step: stepName("review", account, draft.label),
      status: "SKIPPED",
      validation: "deferred — top-N platform review (Standard assurance)",
    });
  }
  // Deep reviews run together: three serial Lens passes were only waiting.
  const reviewed = await Promise.all(deep.map((draft) => reviewOne(ctx, run, account, draft)));
  const byLabel = new Map(reviewed.map((r) => [r.draft.label, r] as const));
  for (const draft of passThrough) byLabel.set(draft.label, { draft });
  return {
    drafts: survivors.map((s) => byLabel.get(s.label)?.draft ?? s),
    notes: reviewed.flatMap((r) => (r.note ? [r.note] : [])),
  };
}

async function reviewOne(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: DraftCandidate,
): Promise<{ draft: DraftCandidate; note?: ReviewNote }> {
  {
    const review = await reviewDraft(ctx, run, account, draft);
    if (!review) return { draft };
    const note = review.issues.length > 0 ? { label: draft.label, issues: review.issues } : undefined;
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
    return { draft: fixed ?? draft, ...(note ? { note } : {}) };
  }
}

/**
 * Checks one draft and, when it fails, gives it its single revision pass.
 * Resolves to the draft that should go forward, or nothing when it is beyond
 * saving.
 */
async function checkAndRevise(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: DraftCandidate,
): Promise<DraftCandidate | undefined> {
  const result = checkDraft(ctx, run, account, draft);
  await ctx.store.addEvent(run.id, {
    step: stepName("checks", account, draft.label),
    status: result.ok ? "SUCCEEDED" : "FAILED",
    validation: result.issues,
  });
  if (result.ok) return draft;

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
  if (revised) return revised;
  await ctx.store.addEvent(run.id, {
    step: stepName("draft-dropped", account, draft.label),
    status: "SKIPPED",
    error: checkErrors(result)
      .map((i) => i.message)
      .join("; "),
  });
  return undefined;
}

/**
 * The drafts of one account are independent, so they are checked and revised
 * together rather than in turn. Revising is a model call: done one after
 * another it cost as long as every other stage combined, for no reason beyond
 * the shape of the loop. Order is kept because the results come back in the
 * order the drafts were given.
 */
async function reviewAccount(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
): Promise<DraftCandidate[]> {
  const settled = await Promise.all(
    latestDraftsByLabel(account).map((draft) => checkAndRevise(ctx, run, account, draft)),
  );
  return settled.filter((d): d is DraftCandidate => d !== undefined);
}

/** REVIEWING: checks, one revision pass, platform review with a fix pass; drops what still fails. */
export async function reviewStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  const counts = await perAccount(run.accounts, async (account) => {
    const survivors = await reviewAccount(ctx, run, account);
    if (survivors.length === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("review", account),
        status: "SKIPPED",
        error: "no draft passed the checks for this account",
      });
      return 0;
    }
    const { drafts, notes } = await platformReview(ctx, run, account, survivors);
    await ctx.store.saveReviewNotes(account.runAccountId, notes);
    return drafts.length;
  });
  if (counts.reduce((a, b) => a + b, 0) === 0) throw new PipelineBlocked("no valid drafts");
}
