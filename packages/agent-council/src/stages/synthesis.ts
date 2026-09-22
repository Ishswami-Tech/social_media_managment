/**
 * Synthesis (first half of ADAPTING): the winning draft plus the elements the
 * judge marked worth borrowing, merged into one post. No new facts may enter
 * here — only rearranging of text that already passed the checks.
 */
import type { DraftCandidate, JudgeVerdict, PipelineContext, RunSnapshot } from "../contracts";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import {
  accountVars,
  claimsText,
  DraftOutputSchema,
  filterClaimIds,
  stepName,
  supportedClaims,
  withSkills,
  type RunAccountSnapshot,
} from "./shared";

const SYNTHESIS_OUTPUT_TOKENS = 1_200;

/** Merged draft, saved with role SYNTHESIS under the winner's label. */
export async function synthesizeDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  winner: DraftCandidate,
  verdict: JudgeVerdict | undefined,
): Promise<DraftCandidate> {
  const rationale = verdict?.scores.find((s) => s.label === winner.label)?.rationale ?? "";
  const borrow = verdict?.borrow ?? [];
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("synthesis", account, winner.label),
      promptKey: "synthesis",
      pref: { provider: winner.provider, model: winner.model },
      temperature: 0.4,
      expectedOutputTokens: SYNTHESIS_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("synthesis", {
          ...accountVars(account),
          claims: claimsText(supportedClaims(run.claims)),
          winner: winner.text,
          winnerHashtags: winner.hashtags.join(" "),
          borrow: borrow.length > 0 ? borrow.map((b) => `- ${b}`).join("\n") : "(nothing to borrow)",
          rationale,
        }),
      ),
      user: "Produce the merged post now. Return only the JSON object.",
    },
    DraftOutputSchema,
  );
  const draft: DraftCandidate = {
    ...winner,
    id: undefined,
    role: "SYNTHESIS",
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
  const id = await ctx.store.saveDraft(run.id, account.runAccountId, draft);
  return { ...draft, id };
}
