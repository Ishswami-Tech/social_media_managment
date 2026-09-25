/**
 * JUDGING: one blind judge per account. The judge sees labels and text only —
 * never a provider, a model, a cost or a temperature — and is routed to a
 * provider that did not write for this account whenever one is available.
 */
import { z } from "zod";
import { AI_PROVIDERS } from "@platform/types";
import type { DraftCandidate, JudgeVerdict, PipelineContext, ReviewNote, RunSnapshot } from "../contracts";
import { PipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson, type ProviderPreference } from "./call";
import { selectCandidates } from "./review";
import { accountVars, stepName, strategyText, type RunAccountSnapshot } from "./shared";

const JUDGE_OUTPUT_TOKENS = 1_200;

export const JudgeOutputSchema = z.object({
  winner: z.string().default(""),
  scores: z
    .array(z.object({ label: z.string(), score: z.number(), rationale: z.string().default("") }))
    .default([]),
  borrow: z.array(z.string()).default([]),
});

/** The only shape the judge ever receives. */
export interface BlindCandidate {
  candidate: string;
  text: string;
}

export function buildCandidates(drafts: readonly DraftCandidate[]): BlindCandidate[] {
  return drafts.map((draft) => ({
    candidate: draft.label,
    text: draft.hashtags.length > 0 ? `${draft.text}\n\nHashtags: ${draft.hashtags.join(" ")}` : draft.text,
  }));
}

export function renderReviewerNotes(notes: readonly ReviewNote[] | undefined, labels: readonly string[]): string {
  const relevant = (notes ?? []).filter((n) => labels.includes(n.label) && n.issues.length > 0);
  if (relevant.length === 0) return "(none)";
  return relevant.map((n) => `Candidate ${n.label}:\n${n.issues.map((i) => `- ${i}`).join("\n")}`).join("\n\n");
}

/**
 * Blindness is a correctness property, not a nicety: fail loudly rather than
 * let a judge see who wrote what.
 */
export function assertBlind(prompt: string, drafts: readonly DraftCandidate[]): void {
  const leaked = [
    ...AI_PROVIDERS.filter((name) => new RegExp(`\\b${name}\\b`).test(prompt)),
    ...drafts.map((d) => d.model).filter((model) => model.length >= 3 && prompt.toLowerCase().includes(model.toLowerCase())),
  ];
  if (leaked.length > 0) throw new Error(`Judge prompt leaked provider identity: ${[...new Set(leaked)].join(", ")}`);
}

/** An invalid winner is repaired from the scores rather than failing the run. */
export function resolveWinner(verdict: z.infer<typeof JudgeOutputSchema>, labels: readonly string[]): string {
  if (labels.includes(verdict.winner)) return verdict.winner;
  const ranked = verdict.scores
    .filter((s) => labels.includes(s.label))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.label);
  return ranked[0] ?? labels[0] ?? "";
}

/** A provider that did not write any of the candidates, when one exists. */
export function judgePreference(
  ctx: PipelineContext,
  drafts: readonly DraftCandidate[],
): ProviderPreference | undefined {
  const writers = new Set(drafts.map((d) => d.provider));
  const outsider = ctx.availableProviders.find((p) => !writers.has(p));
  return outsider ? { provider: outsider } : undefined;
}

async function judgeAccount(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  drafts: readonly DraftCandidate[],
): Promise<void> {
  const labels = drafts.map((d) => d.label);
  const system = renderPrompt("judge", {
    ...accountVars(account),
    goal: run.brief.goal,
    strategy: strategyText(account.strategy),
    candidates: JSON.stringify(buildCandidates(drafts)),
    reviewerNotes: renderReviewerNotes(account.reviewNotes, labels),
  });
  const user = "Judge the candidates now. Return only the JSON object.";
  assertBlind(`${system}\n${user}`, drafts);
  const { value } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("judge", account),
      live: { runAccountId: account.runAccountId, field: "rationale" },
      promptKey: "judge",
      pref: judgePreference(ctx, drafts),
      avoidModels: [...new Set(drafts.map((d) => `${d.provider}::${d.model}`))],
      temperature: 0.2,
      expectedOutputTokens: JUDGE_OUTPUT_TOKENS,
      system,
      user,
    },
    JudgeOutputSchema,
  );
  const verdict: JudgeVerdict = {
    winner: resolveWinner(value, labels),
    scores: value.scores.filter((s) => labels.includes(s.label)),
    borrow: value.borrow,
  };
  for (const score of verdict.scores) {
    const draft = drafts.find((d) => d.label === score.label);
    if (draft?.id) await ctx.store.updateDraftJudgement(draft.id, score.score, score.rationale);
  }
  await ctx.store.saveVerdict(account.runAccountId, verdict);
}

/** JUDGING: a verdict per account with at least one valid draft. */
export async function judgeStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  let judged = 0;
  for (const account of run.accounts) {
    const drafts = selectCandidates(ctx, run, account);
    if (drafts.length === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("judge", account),
        status: "SKIPPED",
        error: "no valid draft to judge for this account",
      });
      continue;
    }
    await judgeAccount(ctx, run, account, drafts);
    judged += 1;
  }
  if (judged === 0) throw new PipelineBlocked("no valid drafts");
}
