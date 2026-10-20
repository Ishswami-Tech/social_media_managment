/**
 * ADAPTING: synthesis, then a platform-native pass (formatting, hashtags, media
 * concept) per account, then the final deterministic gate. What survives is the
 * recommendation the application may approve and publish — the pipeline itself
 * never publishes anything.
 */
import { z } from "zod";
import { checkErrors, runChecks } from "../checks";
import type { DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";
import { PipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import { selectCandidates } from "./review";
import { accountVars, checkInputFor, claimsText, DraftOutputSchema, filterClaimIds, perAccount, stepName, strategyText, stripInlineClaimIds, supportedClaims, type RunAccountSnapshot, withSkills } from "./shared";
import { synthesizeDraft } from "./synthesis";

const ADAPT_OUTPUT_TOKENS = 1_200;

export const AdaptOutputSchema = DraftOutputSchema.extend({ mediaConcept: z.string().optional() });

interface Adapted {
  draft: DraftCandidate;
  mediaConcept?: string;
}

async function adaptDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  synthesized: DraftCandidate,
): Promise<Adapted> {
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("adapt", account, synthesized.label),
      live: { runAccountId: account.runAccountId, field: "text" },
      promptKey: "adapt",
      pref: { provider: synthesized.provider, model: synthesized.model },
      temperature: 0.4,
      expectedOutputTokens: ADAPT_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("adapt", {
          ...accountVars(account),
          strategy: strategyText(account.strategy),
          claims: claimsText(supportedClaims(run.claims)),
          text: synthesized.text,
          hashtags: synthesized.hashtags.join(" "),
        }),
        run,
        account.platform,
        "adapt",
      ),
      user: "Adapt the post to the platform now. Return only the JSON object.",
    },
    AdaptOutputSchema,
  );
  const draft: DraftCandidate = {
    ...synthesized,
    id: undefined,
    role: "ADAPTATION",
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
  return { draft, mediaConcept: value.mediaConcept ?? account.strategy?.mediaConcept };
}

export interface AdaptedRecommendation {
  text: string;
  hashtags: string[];
  mediaConcept?: string;
}

/**
 * The platform pass on one draft, then the final gate, then the
 * recommendation. Shared by the stage (judge's pick, synthesised) and by a
 * person overriding the judge with another draft.
 */
export async function finishWithDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  source: DraftCandidate,
  winner: DraftCandidate,
): Promise<AdaptedRecommendation> {
  const { draft, mediaConcept } = await adaptDraft(ctx, run, account, source);
  const checks = runChecks(checkInputFor(ctx, run, account, draft, Boolean(mediaConcept)));
  const id = await ctx.store.saveDraft(run.id, account.runAccountId, draft, { checks });
  await ctx.store.addEvent(run.id, {
    step: stepName("checks", account, `${draft.label}.final`),
    status: checks.ok ? "SUCCEEDED" : "FAILED",
    validation: checks.issues,
  });
  if (!checks.ok) {
    throw new PipelineBlocked(
      `final checks failed: ${checkErrors(checks)
        .map((i) => i.message)
        .join("; ")}`,
      { runAccountId: account.runAccountId, draftId: id, issues: checks.issues },
    );
  }
  await ctx.store.saveRecommendation({
    runAccountId: account.runAccountId,
    finalText: draft.text,
    hashtags: draft.hashtags,
    claimIds: draft.claimIds,
    mediaConcept,
    winnerDraftLabel: winner.label,
    winnerDraftId: winner.id,
  });
  return { text: draft.text, hashtags: draft.hashtags, ...(mediaConcept ? { mediaConcept } : {}) };
}

/** A person's override of the judge: this draft, straight through the platform pass. */
export async function adaptChosenDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  draft: DraftCandidate,
): Promise<AdaptedRecommendation> {
  await ctx.store.addEvent(run.id, {
    step: stepName("choose-draft", account, draft.label),
    status: "SUCCEEDED",
    output: { draftId: draft.id, label: draft.label },
  });
  return finishWithDraft(ctx, run, account, draft, draft);
}

async function adaptAccount(ctx: PipelineContext, run: RunSnapshot, account: RunAccountSnapshot): Promise<boolean> {
  const candidates = selectCandidates(ctx, run, account);
  if (candidates.length === 0) {
    await ctx.store.addEvent(run.id, {
      step: stepName("adapt", account),
      status: "SKIPPED",
      error: "no valid draft to adapt for this account",
    });
    return false;
  }
  const winnerLabel = account.verdict?.winner;
  const winner = candidates.find((d) => d.label === winnerLabel) ?? candidates[0]!;
  const synthesized = await synthesizeDraft(ctx, run, account, winner, account.verdict);
  await finishWithDraft(ctx, run, account, synthesized, winner);
  return true;
}

/** ADAPTING: one recommendation per account that still has a valid draft. */
export async function adaptingStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  const produced = await perAccount(run.accounts, (account) => adaptAccount(ctx, run, account));
  if (!produced.some(Boolean)) throw new PipelineBlocked("no valid drafts");
}
