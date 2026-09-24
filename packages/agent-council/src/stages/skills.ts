/**
 * Skill selection: before anything is written, the pipeline decides which of
 * the organization's playbooks apply to this campaign. What the person picked
 * by hand and every "always" playbook are kept; a small planning call adds
 * the platform-relevant ones. The choice is persisted on the run so the
 * writers, the platform review and the UI all see the same list.
 */
import { z } from "zod";
import type { PipelineContext, RunSnapshot, SkillCard } from "../contracts";
import { errorMessage, isPipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";

/** Total playbooks a run may carry (manual + always + automatic). */
export const MAX_RUN_SKILLS = 8;
/** How many the planner may add on its own. */
export const MAX_AUTO_SKILLS = 4;
const SKILLS_OUTPUT_TOKENS = 400;
const DESCRIPTION_CHARS = 220;

export const SkillsOutputSchema = z.object({
  picks: z.array(z.object({ id: z.string().min(1), why: z.string().default("") })).default([]),
});

export interface SkillChoice {
  id: string;
  name: string;
  why: string;
}

/** A playbook fits a platform when it names it, or names none at all. */
export function skillFitsPlatform(card: Pick<SkillCard, "platforms">, platform: string): boolean {
  return card.platforms.length === 0 || card.platforms.includes(platform);
}

/** Playbooks worth offering the planner: relevant to at least one target platform. */
export function candidateSkills(cards: readonly SkillCard[], platforms: readonly string[]): SkillCard[] {
  return cards.filter((card) => platforms.some((p) => skillFitsPlatform(card, p)));
}

const WRITING_HINT = /\b(post|write|writer|writing|humaniz|hook|repurpos|caption|copy)\b/i;
const OTHER_JOB_HINT = /\b(comment|reply|replies|profile|analytics|calendar|planner|interview|monitor|advocacy)\b/i;

/** Rule-based fallback when the planner call fails: writing playbooks first, other jobs never. */
export function pickSkillsByRule(candidates: readonly SkillCard[], max: number = MAX_AUTO_SKILLS): SkillCard[] {
  return candidates
    .filter((c) => WRITING_HINT.test(`${c.name} ${c.description}`) && !OTHER_JOB_HINT.test(c.name))
    .slice(0, max);
}

/** Manual picks first (in the order chosen), then "always" playbooks, then the automatic ones; capped. */
export function mergeSkillIds(
  manual: readonly string[],
  always: readonly string[],
  automatic: readonly string[],
  max: number = MAX_RUN_SKILLS,
): string[] {
  return [...new Set([...manual, ...always, ...automatic])].slice(0, max);
}

function catalogueText(cards: readonly SkillCard[]): string {
  return cards
    .map((c) => `${c.id} — ${c.name}: ${c.description.replace(/\s+/g, " ").slice(0, DESCRIPTION_CHARS)}`)
    .join("\n");
}

async function planPicks(ctx: PipelineContext, run: RunSnapshot, candidates: readonly SkillCard[]): Promise<SkillChoice[]> {
  const { value } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: "skills",
      promptKey: "skills",
      temperature: 0,
      expectedOutputTokens: SKILLS_OUTPUT_TOKENS,
      system: renderPrompt("skills", {
        topic: run.brief.topic,
        goal: run.brief.goal,
        audience: run.brief.audience ?? "(not specified)",
        notes: run.brief.notes ?? "(none)",
        platforms: run.brief.platforms.join(", "),
        catalogue: catalogueText(candidates),
        maxPicks: MAX_AUTO_SKILLS,
      }),
      user: "Choose the playbooks for this campaign now. Return only the JSON object.",
    },
    SkillsOutputSchema,
  );
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return value.picks.flatMap((p) => {
    const card = byId.get(p.id);
    return card ? [{ id: card.id, name: card.name, why: p.why }] : [];
  });
}

/**
 * Decides the run's playbooks and persists them. Never blocks the run: when
 * the planner cannot answer, a rule-based pick is used and the trail says so.
 */
export async function selectSkills(ctx: PipelineContext, run: RunSnapshot): Promise<string[]> {
  const cards = ctx.skills ?? [];
  const manual = (run.skillIds ?? []).filter((id) => cards.some((c) => c.id === id));
  const always = cards.filter((c) => c.always).map((c) => c.id);
  const candidates = candidateSkills(cards, run.brief.platforms).filter(
    (c) => !manual.includes(c.id) && !always.includes(c.id),
  );
  let automatic: SkillChoice[] = [];
  let note: string | undefined;
  if (candidates.length > 0) {
    try {
      automatic = (await planPicks(ctx, run, candidates)).slice(0, MAX_AUTO_SKILLS);
    } catch (error) {
      if (isPipelineBlocked(error)) throw error;
      automatic = pickSkillsByRule(candidates).map((c) => ({ id: c.id, name: c.name, why: "picked by rule" }));
      note = `planner failed (${errorMessage(error)}); picked by rule`;
    }
  }
  const skillIds = mergeSkillIds(manual, always, automatic.map((a) => a.id));
  await ctx.store.saveSkills(run.id, skillIds);
  const nameOf = (id: string) => cards.find((c) => c.id === id)?.name ?? id;
  await ctx.store.addEvent(run.id, {
    step: "skills",
    status: "SUCCEEDED",
    output: {
      skills: skillIds.map(nameOf),
      chosen: skillIds.map((id) => ({
        id,
        name: nameOf(id),
        source: manual.includes(id) ? "manual" : always.includes(id) ? "always" : "automatic",
        why: automatic.find((a) => a.id === id)?.why ?? "",
      })),
    },
    ...(note ? { validation: note } : {}),
  });
  return skillIds;
}
