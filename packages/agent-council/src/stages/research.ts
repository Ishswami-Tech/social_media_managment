/**
 * RESEARCHING: a tool-using agent produces a sourced brief, then a second,
 * cheaper call turns that brief into the claims ledger every later stage is
 * allowed to cite. Nothing downstream may state a fact that is not here.
 */
import { z } from "zod";
import type { Brief } from "@platform/research";
import { BriefSchema } from "@platform/research";
import type { ClaimRecord, PipelineContext, RunSnapshot } from "../contracts";
import { errorMessage } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson, callModel } from "./call";
import { stringify } from "./shared";

const RESEARCH_MAX_STEPS = 6;
const RESEARCH_OUTPUT_TOKENS = 2_500;
const CLAIMS_OUTPUT_TOKENS = 1_500;
const CLAIMS_BRIEF_CHARS = 12_000;

export const ClaimsOutputSchema = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().min(1),
        sourceUrl: z.string().optional(),
        sourceTitle: z.string().optional(),
        evidence: z.string().optional(),
        confidence: z.number().min(0).max(1).default(0.5),
        status: z.enum(["SUPPORTED", "UNSUPPORTED", "UNVERIFIED"]).default("UNVERIFIED"),
      }),
    )
    .default([]),
});

/** Used when the research agent returns something that is not a valid brief. */
export function fallbackBrief(run: RunSnapshot, raw: string): Brief {
  return {
    title: run.brief.topic,
    summary: raw.slice(0, 2_000),
    keyPoints: [],
    angles: [],
    postIdeas: [],
    sources: [],
    caveats: ["The research output could not be parsed; no sources are available, so no claim can be SUPPORTED."],
  };
}

function brandClause(run: RunSnapshot): string {
  const brand = run.accounts.find((a) => a.profile.identity?.brand)?.profile.identity?.brand;
  return brand ? ` for the brand "${brand}"` : "";
}

/** A claim can only be SUPPORTED when it carries both a source URL and evidence. */
export function normalizeClaims(claims: z.infer<typeof ClaimsOutputSchema>["claims"]): ClaimRecord[] {
  return claims.map((claim, index) => {
    const supported = claim.status === "SUPPORTED" && Boolean(claim.sourceUrl) && Boolean(claim.evidence);
    return {
      id: `claim_${index + 1}`,
      statement: claim.statement,
      sourceUrl: claim.sourceUrl,
      sourceTitle: claim.sourceTitle,
      evidence: claim.evidence,
      confidence: claim.confidence,
      status: claim.status === "SUPPORTED" && !supported ? "UNVERIFIED" : claim.status,
    };
  });
}

async function produceBrief(ctx: PipelineContext, run: RunSnapshot): Promise<Brief> {
  const system = renderPrompt("research", {
    brandClause: brandClause(run),
    topic: run.brief.topic,
    goal: run.brief.goal,
    audience: run.brief.audience ?? "(not specified)",
    notes: run.brief.notes ?? "(none)",
    platforms: run.brief.platforms.join(", "),
  });
  const call = await callModel(ctx, {
    runId: run.id,
    organizationId: run.organizationId,
    step: "research",
    promptKey: "research",
    capability: "json",
    json: true,
    temperature: 0.4,
    expectedOutputTokens: RESEARCH_OUTPUT_TOKENS,
    tools: ctx.researchTools,
    maxSteps: RESEARCH_MAX_STEPS,
    system,
    user: `Research this campaign now and return the brief as JSON.\nTopic: ${run.brief.topic}\nGoal: ${run.brief.goal}`,
  });
  const parsed = BriefSchema.safeParse(safeJson(call.text));
  if (parsed.success) return parsed.data;
  await ctx.store.addEvent(run.id, {
    step: "research",
    status: "SUCCEEDED",
    promptKey: call.promptKey,
    promptVersion: call.promptVersion,
    promptHash: call.promptHash,
    validation: `brief did not validate, using a minimal brief: ${errorMessage(parsed.error)}`,
  });
  return fallbackBrief(run, call.text);
}

function safeJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** RESEARCHING: brief + claims ledger, persisted through the store. */
export async function researchStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  const brief = await produceBrief(ctx, run);
  const { value } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: "claims",
      promptKey: "claims",
      temperature: 0.1,
      expectedOutputTokens: CLAIMS_OUTPUT_TOKENS,
      system: renderPrompt("claims", { brief: stringify(brief).slice(0, CLAIMS_BRIEF_CHARS) }),
      user: "Extract the claims ledger for this brief now. Return only the JSON object.",
    },
    ClaimsOutputSchema,
  );
  await ctx.store.saveResearch(run.id, brief, normalizeClaims(value.claims));
}
