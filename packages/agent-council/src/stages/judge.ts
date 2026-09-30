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
import { council, councilPrefs, recordSeatFailure, seatPerspective, seatStep, uniqueStrings, withPerspective } from "./council";
import { selectCandidates } from "./review";
import { accountVars, perAccount, stepName, strategyText, type RunAccountSnapshot } from "./shared";

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
  const writersModels = new Set(drafts.map((d) => `${d.provider}::${d.model}`));
  const prefs = await councilPrefs(ctx, writersModels);
  const votes = await council(prefs, (pref, index, others) =>
    callJson(
      ctx,
      {
        runId: run.id,
        organizationId: run.organizationId,
        step: seatStep(stepName("judge", account), index, prefs.length),
        live: { runAccountId: account.runAccountId, field: "rationale" },
        promptKey: "judge",
        pref: prefs.length > 1 ? pref : judgePreference(ctx, drafts),
        avoidModels: [...writersModels, ...others],
        temperature: 0.2,
        expectedOutputTokens: JUDGE_OUTPUT_TOKENS,
        system,
        user: withPerspective(user, seatPerspective("judge", index, prefs.length)),
      },
      JudgeOutputSchema,
    ),
    recordSeatFailure(ctx, run.id, stepName("judge", account), prefs.length),
  );
  const verdict = tally(votes.map((v) => v.value), labels);
  for (const score of verdict.scores) {
    const draft = drafts.find((d) => d.label === score.label);
    if (draft?.id) await ctx.store.updateDraftJudgement(draft.id, score.score, score.rationale);
  }
  await ctx.store.saveVerdict(account.runAccountId, verdict);
}

/**
 * Several judges become one verdict: each label's score is the average over
 * the judges who scored it, the winner is the best average, the rationale is
 * the winning judges' reasons joined, and every borrowable element is kept.
 */
export function tally(
  votes: readonly { winner: string; scores: { label: string; score: number; rationale: string }[]; borrow: string[] }[],
  labels: readonly string[],
): JudgeVerdict {
  if (votes.length === 1) {
    const only = votes[0]!;
    return { winner: resolveWinner(only, labels), scores: only.scores.filter((s) => labels.includes(s.label)), borrow: only.borrow };
  }
  const scores = labels.flatMap((label) => {
    const given = votes.flatMap((v) => v.scores.filter((s) => s.label === label));
    if (given.length === 0) return [];
    const score = Math.round((given.reduce((sum, s) => sum + s.score, 0) / given.length) * 10) / 10;
    const rationale = uniqueStrings(given.map((s) => s.rationale)).join(" · ");
    return [{ label, score, rationale }];
  });
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const winner = ranked[0]?.label ?? resolveWinner(votes[0]!, labels);
  return { winner, scores, borrow: uniqueStrings(votes.flatMap((v) => v.borrow)) };
}

/** JUDGING: a verdict per account with at least one valid draft. */
export async function judgeStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  const judged = await perAccount(run.accounts, async (account) => {
    const drafts = selectCandidates(ctx, run, account);
    if (drafts.length === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("judge", account),
        status: "SKIPPED",
        error: "no valid draft to judge for this account",
      });
      return false;
    }
    await judgeAccount(ctx, run, account, drafts);
    return true;
  });
  if (!judged.some(Boolean)) throw new PipelineBlocked("no valid drafts");
}
