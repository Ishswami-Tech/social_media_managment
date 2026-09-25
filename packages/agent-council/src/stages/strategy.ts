/**
 * STRATEGIZING: one plan per account. The plan is what the writers must follow,
 * so it fixes the angle, the hook type, the format, the CTA and which SUPPORTED
 * claims may be cited.
 */
import { z } from "zod";
import type { AccountStrategy, PipelineContext, RunSnapshot } from "../contracts";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import { accountVars, claimsText, filterClaimIds, stepName, stringify, supportedClaims } from "./shared";
import { selectSkills } from "./skills";

const STRATEGY_OUTPUT_TOKENS = 900;
const BRIEF_CHARS = 8_000;

export const StrategyOutputSchema = z.object({
  angle: z.string().min(1),
  hookType: z.string().default("story"),
  format: z.string().default("text post"),
  cta: z.string().default(""),
  keyPoints: z.array(z.string()).default([]),
  claimIds: z.array(z.string()).default([]),
  rationale: z.string().default(""),
  mediaConcept: z.string().optional(),
});

/** STRATEGIZING: the playbooks for the campaign, then a strategy per run account, persisted through the store. */
export async function strategyStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  await selectSkills(ctx, run);
  const claims = supportedClaims(run.claims);
  const brief = run.research ? stringify(run.research).slice(0, BRIEF_CHARS) : "(no research brief available)";
  for (const account of run.accounts) {
    const { value } = await callJson(
      ctx,
      {
        runId: run.id,
        organizationId: run.organizationId,
        step: stepName("strategy", account),
        live: { runAccountId: account.runAccountId, field: "angle" },
        promptKey: "strategy",
        temperature: 0.5,
        expectedOutputTokens: STRATEGY_OUTPUT_TOKENS,
        system: renderPrompt("strategy", {
          ...accountVars(account),
          topic: run.brief.topic,
          goal: run.brief.goal,
          audience: run.brief.audience ?? "(not specified)",
          notes: run.brief.notes ?? "(none)",
          brief,
          claims: claimsText(claims),
        }),
        user: "Design the strategy for this account now. Return only the JSON object.",
      },
      StrategyOutputSchema,
    );
    const strategy: AccountStrategy = {
      ...value,
      claimIds: filterClaimIds(value.claimIds, run.claims),
    };
    await ctx.store.saveStrategy(account.runAccountId, strategy);
  }
}
