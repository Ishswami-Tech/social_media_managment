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
import { callJson, callModel, type ProviderPreference } from "./call";
import { council, councilPrefs, recordSeatFailure, seatPerspective, seatStep, stageCouncilSize, uniqueStrings, withPerspective } from "./council";
import { encodeContext } from "./shared";

const RESEARCH_MAX_STEPS = 6;
const RESEARCH_OUTPUT_TOKENS = 2_500;
const CLAIMS_OUTPUT_TOKENS = 1_500;
const CLAIMS_BRIEF_CHARS = 24_000;
/** A brief researched this recently for the same topic is reused instead of researched again. */
const RESEARCH_REUSE_MS = 3 * 24 * 60 * 60 * 1000;

/** Models write `null` for a field they have nothing for; that is "absent", not a broken answer. */
const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v ? v : undefined));

export const ClaimsOutputSchema = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().min(1),
        sourceUrl: optionalText,
        sourceTitle: optionalText,
        evidence: optionalText,
        confidence: z
          .number()
          .min(0)
          .max(1)
          .nullish()
          .transform((v) => v ?? 0.5),
        status: z
          .enum(["SUPPORTED", "UNSUPPORTED", "UNVERIFIED"])
          .nullish()
          .transform((v) => v ?? "UNVERIFIED"),
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
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

/** One line per tool the model can actually call, so the prompt never advertises a missing one. */
const TOOL_GUIDES: Record<string, string> = {
  web_search: "web_search: search the public web for recent, reputable material; refine the query when results are weak.",
  read_url: "read_url: read a public page in full; use it on search results, URLs in the notes, or well-known primary sources.",
  read_feed: "read_feed: read an RSS/Atom feed.",
  brand_knowledge: "brand_knowledge: facts the organization recorded about its brand, products and voice.",
  recent_posts_performance: "recent_posts_performance: what this audience engaged with recently.",
};

export function toolGuide(tools: readonly { definition: { name: string; description: string } }[]): string {
  if (tools.length === 0) return "- No tools are available. Work only from the campaign details and clearly mark unverified statements as caveats.";
  const lines = tools.map((t) => `- ${TOOL_GUIDES[t.definition.name] ?? `${t.definition.name}: ${t.definition.description}`}`);
  const hasSearch = tools.some((t) => t.definition.name === "web_search");
  return hasSearch
    ? lines.join("\n")
    : [
        ...lines,
        "- There is no web search. Reach sources through read_url on URLs from the campaign notes, official sites and documentation you already know, and through the brand and performance tools.",
      ].join("\n");
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

/** Several briefs become one: the fullest brief leads, every source, point and idea is kept once, summaries are joined. */
export function mergeBriefs(input: readonly Brief[]): Brief {
  const richness = (b: Brief) => b.sources.length * 2 + b.keyPoints.length + b.angles.length;
  const briefs = [...input].sort((a, b) => richness(b) - richness(a));
  const first = briefs[0]!;
  if (briefs.length === 1) return first;
  const byUrl = new Map<string, Brief["sources"][number]>();
  for (const b of briefs) for (const s of b.sources) if (s.url && !byUrl.has(s.url)) byUrl.set(s.url, s);
  const seenHooks = new Set<string>();
  const angles = briefs.flatMap((b) => b.angles).filter((a) => {
    const key = a.hook.trim().toLowerCase();
    if (!key || seenHooks.has(key)) return false;
    seenHooks.add(key);
    return true;
  });
  const seenIdeas = new Set<string>();
  const postIdeas = briefs.flatMap((b) => b.postIdeas).filter((p) => {
    const key = `${p.platform}:${p.text.trim().toLowerCase()}`;
    if (seenIdeas.has(key)) return false;
    seenIdeas.add(key);
    return true;
  });
  return {
    ...first,
    summary: uniqueStrings(briefs.map((b) => b.summary)).join("\n\n"),
    keyPoints: uniqueStrings(briefs.flatMap((b) => b.keyPoints)),
    caveats: uniqueStrings(briefs.flatMap((b) => b.caveats)),
    angles,
    postIdeas,
    sources: [...byUrl.values()],
  };
}

async function produceBrief(ctx: PipelineContext, run: RunSnapshot): Promise<Brief> {
  const prefs = await councilPrefs(ctx, undefined, stageCouncilSize(ctx, "research"));
  const briefs = await council(
    prefs,
    (pref, index, others) => produceOneBrief(ctx, run, pref, seatStep("research", index, prefs.length), others, seatPerspective("research", index, prefs.length)),
    recordSeatFailure(ctx, run.id, "research", prefs.length),
  );
  return mergeBriefs(briefs);
}

async function produceOneBrief(
  ctx: PipelineContext,
  run: RunSnapshot,
  pref: ProviderPreference,
  step: string,
  avoidModels: string[],
  perspective: string | undefined,
): Promise<Brief> {
  const system = renderPrompt("research", {
    today: new Date().toISOString().slice(0, 10),
    brandClause: brandClause(run),
    toolGuide: toolGuide(ctx.researchTools),
    topic: run.brief.topic,
    goal: run.brief.goal,
    audience: run.brief.audience ?? "(not specified)",
    notes: run.brief.notes ?? "(none)",
    platforms: run.brief.platforms.join(", "),
  });
  const call = await callModel(ctx, {
    runId: run.id,
    organizationId: run.organizationId,
    step,
    pref,
    avoidModels,
    live: { field: "summary" },
    promptKey: "research",
    capability: "json",
    json: true,
    temperature: 0.4,
    expectedOutputTokens: RESEARCH_OUTPUT_TOKENS,
    tools: ctx.researchTools,
    maxSteps: RESEARCH_MAX_STEPS,
    system,
    user: withPerspective(`Research this campaign now and return the brief as JSON.\nTopic: ${run.brief.topic}\nGoal: ${run.brief.goal}`, perspective),
  });
  const parsed = BriefSchema.safeParse(safeJson(call.text));
  if (parsed.success) return parsed.data;
  await ctx.store.addEvent(run.id, {
    step,
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
  // The same topic researched a few days ago is remembered, not researched again.
  const remembered = await ctx.store.findRecentResearch?.(run.organizationId, run.brief.topic, RESEARCH_REUSE_MS);
  if (remembered && remembered.claims.length > 0) {
    await ctx.store.saveResearch(run.id, remembered.brief, remembered.claims);
    await ctx.store.addEvent(run.id, {
      step: "research",
      status: "SUCCEEDED",
      output: { reusedFrom: remembered.researchedAt.slice(0, 10), facts: remembered.claims.length },
    });
    return;
  }
  const brief = await produceBrief(ctx, run);
  const { value } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: "claims",
      live: { field: "statement" },
      promptKey: "claims",
      temperature: 0.1,
      expectedOutputTokens: CLAIMS_OUTPUT_TOKENS,
      system: renderPrompt("claims", { brief: encodeContext(brief).slice(0, CLAIMS_BRIEF_CHARS) }),
      user: "Extract the claims ledger for this brief now. Return only the JSON object.",
    },
    ClaimsOutputSchema,
  );
  await ctx.store.saveResearch(run.id, brief, normalizeClaims(value.claims));
}
