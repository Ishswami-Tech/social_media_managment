/**
 * STRATEGIZING: one plan per account. The plan is what the writers must follow,
 * so it fixes the angle, the hook type, the format, the CTA and which SUPPORTED
 * claims may be cited.
 */
import { z } from "zod";
import type { AccountStrategy, PipelineContext, RunSnapshot } from "../contracts";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import { council, councilPrefs, recordSeatFailure, seatPerspective, seatStep, withPerspective } from "./council";
import { accountVars, claimsText, encodeContext, filterClaimIds, perAccount, stepName, supportedClaims } from "./shared";
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
  const brief = run.research ? encodeContext(run.research).slice(0, BRIEF_CHARS) : "(no research brief available)";
  await perAccount(run.accounts, async (account) => {
    const prefs = await councilPrefs(ctx);
    const proposals = await council(prefs, (pref, index, others) =>
      callJson(
      ctx,
      {
        runId: run.id,
        organizationId: run.organizationId,
        step: seatStep(stepName("strategy", account), index, prefs.length),
        pref,
        avoidModels: others,
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
        user: withPerspective("Design the strategy for this account now. Return only the JSON object.", seatPerspective("strategy", index, prefs.length)),
      },
      StrategyOutputSchema,
      ),
      recordSeatFailure(ctx, run.id, stepName("strategy", account), prefs.length),
    );
    const scored = proposals.map((p) => ({ ...p, claimIds: filterClaimIds(p.value.claimIds, run.claims) }));
    const best = pickStrategy(scored);
    const others = scored.filter((p) => p !== best);
    const strategy: AccountStrategy = {
      ...best.value,
      claimIds: best.claimIds,
      ...(others.length > 0
        ? { alternatives: others.map((o) => ({ angle: o.value.angle, hookType: o.value.hookType, model: o.call.model })) }
        : {}),
    };
    await ctx.store.saveStrategy(account.runAccountId, strategy);
  });
}

/** The proposal that leans on the most allowed facts wins; ties go to the fuller rationale, then to the first. */
export function pickStrategy<T extends { claimIds: string[]; value: { rationale: string } }>(proposals: readonly T[]): T {
  return [...proposals].sort((a, b) => b.claimIds.length - a.claimIds.length || b.value.rationale.length - a.value.rationale.length)[0]!;
}
