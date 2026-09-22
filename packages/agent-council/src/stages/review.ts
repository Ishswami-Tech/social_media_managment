/**
 * REVIEWING: deterministic checks first (no model, no cost). Only drafts that
 * fail go through the revision editor, once. Drafts that still fail are dropped
 * — the judge must never see a draft that breaks a rule. HIGH_ASSURANCE adds a
 * cross-review by a provider that did not write the draft.
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

export const ReviewNotesOutputSchema = z.object({ issues: z.array(z.string()).default([]) });

/** One draft per label: the revision when there is one, otherwise the original. */
export function latestDraftsByLabel(account: RunAccountSnapshot): DraftCandidate[] {
  const byLabel = new Map<string, DraftCandidate>();
  for (const draft of account.drafts) {
    if (draft.role !== "WRITER" && draft.role !== "REVISION") continue;
    const current = byLabel.get(draft.label);
    if (!current || (current.role === "WRITER" && draft.role === "REVISION")) byLabel.set(draft.label, draft);
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

async function reviseDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: DraftCandidate,
  result: CheckResult,
): Promise<DraftCandidate | undefined> {
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("revision", account, draft.label),
      promptKey: "revision",
      pref: { provider: draft.provider, model: draft.model },
      temperature: 0.3,
      expectedOutputTokens: REVISION_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("revision", {
          ...accountVars(account),
          claims: claimsText(supportedClaims(run.claims)),
          issues: result.issues.map((i) => `- [${i.severity}] ${i.code}: ${i.message}`).join("\n"),
          text: draft.text,
          hashtags: draft.hashtags.join(" "),
        }),
      ),
      user: "Revise the draft now. Return only the JSON object.",
    },
    DraftOutputSchema,
  );
  const revised: DraftCandidate = {
    ...draft,
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
    step: stepName("checks", account, `${draft.label}.revision`),
    status: recheck.ok ? "SUCCEEDED" : "FAILED",
    validation: recheck.issues,
  });
  return recheck.ok ? { ...revised, id } : undefined;
}

async function crossReview(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  drafts: readonly DraftCandidate[],
): Promise<ReviewNote[]> {
  const notes: ReviewNote[] = [];
  for (const draft of drafts) {
    const other = ctx.availableProviders.find((p) => p !== draft.provider);
    try {
      const { value } = await callJson(
        ctx,
        {
          runId: run.id,
          organizationId: run.organizationId,
          step: stepName("cross-review", account, draft.label),
          promptKey: "review",
          pref: other ? { provider: other } : undefined,
          temperature: 0.2,
          expectedOutputTokens: REVIEW_OUTPUT_TOKENS,
          system: renderPrompt("review", {
            ...accountVars(account),
            strategy: strategyText(account.strategy),
            claims: claimsText(supportedClaims(run.claims)),
            text: draft.text,
            hashtags: draft.hashtags.join(" "),
          }),
          user: "List the issues you found. Return only the JSON object.",
        },
        ReviewNotesOutputSchema,
      );
      if (value.issues.length > 0) notes.push({ label: draft.label, issues: value.issues });
    } catch (error) {
      if (isPipelineBlocked(error)) throw error;
      await ctx.store.addEvent(run.id, {
        step: stepName("cross-review", account, draft.label),
        status: "SKIPPED",
        error: errorMessage(error),
      });
    }
  }
  return notes;
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
    const revised = await reviseDraft(ctx, run, account, draft, result).catch(async (error: unknown) => {
      if (isPipelineBlocked(error)) throw error;
      await ctx.store.addEvent(run.id, {
        step: stepName("revision", account, draft.label),
        status: "SKIPPED",
        error: errorMessage(error),
      });
      return undefined;
    });
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

/** REVIEWING: checks, one revision pass, optional cross-review; drops what still fails. */
export async function reviewStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  let survivingTotal = 0;
  for (const account of run.accounts) {
    const survivors = await reviewAccount(ctx, run, account);
    survivingTotal += survivors.length;
    if (survivors.length === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("review", account),
        status: "SKIPPED",
        error: "no draft passed the checks for this account",
      });
      continue;
    }
    if (run.assurance === "HIGH_ASSURANCE") {
      const notes = await crossReview(ctx, run, account, survivors);
      await ctx.store.saveReviewNotes(account.runAccountId, notes);
    }
  }
  if (survivingTotal === 0) throw new PipelineBlocked("no valid drafts");
}
