/**
 * The planning agent: turns a theme and a set of accounts into a month of
 * post ideas spread over posting days, each with a goal and a funnel role
 * (awareness, trust, offer) so the month sells rather than just posts. An
 * item becomes an Agent Council run when a person starts it; the run publishes
 * on the item's date after approval.
 */
import { z } from "zod";
import { parseJsonOutput } from "@platform/ai-core";
import type { Platform } from "@platform/types";
import type { Prisma } from "@platform/database";
import { aiRuntime } from "@/lib/ai";
import { toSkillCard } from "@/lib/agent/skill-cards";
import { createRun, type AgentRunDetail } from "@/lib/agent/runs";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { brandContext } from "@/lib/services/brand";
import { storiesForWriters } from "@/lib/services/memory";
import type { OrgContext } from "@/lib/session";

export const FUNNEL_STAGES = ["awareness", "trust", "offer"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const PLAN_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const planInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  theme: z.string().trim().min(3).max(2000),
  audience: z.string().trim().max(500).optional(),
  socialAccountIds: z.array(z.string().min(1)).min(1).max(10),
  startDate: z.string().date(),
  days: z.number().int().min(7).max(60).default(30),
  postsPerWeek: z.number().int().min(1).max(7).default(3),
});
export type PlanInput = z.infer<typeof planInput>;

export const planItemSchema = z.object({
  date: z.string().date(),
  platform: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  idea: z.string().trim().min(3).max(1200),
  goal: z.string().trim().min(3).max(300),
  format: z.string().trim().max(60).default("text post"),
  funnel: z.enum(FUNNEL_STAGES).default("awareness"),
  runId: z.string().optional(),
});
export type PlanItem = z.infer<typeof planItemSchema>;
/** An item as shown: what its campaign is doing, when one was started. */
export type PlanItemView = PlanItem & { runStatus?: string };

export const planUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    status: z.enum(PLAN_STATUSES),
  })
  .partial()
  .refine((v) => v.name !== undefined || v.status !== undefined, { message: "Nothing to change" });
export type PlanUpdateInput = z.infer<typeof planUpdateInput>;

const NAME_MAX_CHARS = 60;

/** A name from the theme when none was given: its first sentence, cut short. */
export function planName(theme: string): string {
  const firstLine = theme.split(/\r?\n/)[0]?.trim() ?? "";
  const sentence = firstLine.split(/(?<=[.!?;])\s/)[0] ?? firstLine;
  const trimmed = sentence.replace(/[.,;:!?]+$/, "").trim();
  if (!trimmed) return "Untitled plan";
  return trimmed.length > NAME_MAX_CHARS ? `${trimmed.slice(0, NAME_MAX_CHARS - 1).trimEnd()}…` : trimmed;
}

const PlanOutputSchema = z.object({ items: z.array(planItemSchema.omit({ runId: true })).min(1) });

export interface ContentPlanView {
  id: string;
  name: string;
  status: PlanStatus;
  theme: string;
  audience: string | null;
  platforms: string[];
  startDate: string;
  days: number;
  items: PlanItemView[];
  createdAt: string;
}

const PLAN_OUTPUT_TOKENS = 6_000;
const MAX_ITEMS = 40;
const PLANNING_SKILL_HINT = /\b(plan|planner|calendar|strategy|content)\b/i;
const PUBLISH_HOUR = 9;

/** Posting dates spread evenly over the period, weekdays first. */
export function spreadDates(startDate: string, days: number, postsPerWeek: number): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const total = Math.min(MAX_ITEMS, Math.max(1, Math.round((days / 7) * postsPerWeek)));
  const step = days / total;
  const dates: string[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getTime() + Math.floor(i * step) * 86_400_000);
    // Nudge Saturday/Sunday to the next Monday unless the plan posts daily.
    if (postsPerWeek < 7) {
      const weekday = d.getUTCDay();
      if (weekday === 6) d.setUTCDate(d.getUTCDate() + 2);
      else if (weekday === 0) d.setUTCDate(d.getUTCDate() + 1);
    }
    const iso = d.toISOString().slice(0, 10);
    if (dates[dates.length - 1] !== iso) dates.push(iso);
  }
  return dates;
}

/** The funnel role each slot should play: awareness first, then trust, then an offer, repeating. */
export function funnelFor(index: number, total: number): FunnelStage {
  if (total <= 1) return "offer";
  const position = index / (total - 1);
  if (position < 0.45) return "awareness";
  if (position < 0.8) return "trust";
  return "offer";
}

export function planPrompt(input: {
  theme: string;
  audience?: string;
  platforms: string[];
  slots: { date: string; funnel: FunnelStage }[];
  brand?: { name: string; industry?: string; positioning?: string; tone?: string };
  stories: { title?: string; text: string }[];
}): string {
  const slots = input.slots.map((s) => `- ${s.date} (${s.funnel})`).join("\n");
  const stories = input.stories.length
    ? input.stories.map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.text.slice(0, 300)}`).join("\n")
    : "(none recorded yet)";
  return `You are the content strategist of a social media team. Plan one post per slot below for ${input.platforms.join(", ")}. The month must move readers toward buying: "awareness" slots earn attention with insight or a story, "trust" slots prove results (numbers, cases, behind the scenes, mistakes fixed), "offer" slots make a clear invitation (book, try, reply, DM) without hype.

THEME: ${input.theme}
AUDIENCE: ${input.audience ?? "(as recorded for the brand)"}
BRAND: ${input.brand ? `${input.brand.name}${input.brand.industry ? ` · ${input.brand.industry}` : ""}${input.brand.positioning ? ` · ${input.brand.positioning}` : ""}${input.brand.tone ? ` · tone: ${input.brand.tone}` : ""}` : "(not set)"}

STORY BANK (real material; prefer it over generic advice, never invent numbers)
${stories}

SLOTS (one post each, keep the date and the funnel role)
${slots}

RULES
1. Every item is a distinct, specific post idea a writer can execute without asking questions: a concrete angle, the real detail it uses, and what the reader should do.
2. Vary formats across the month: story, tip, list, case study, contrarian take, question, behind the scenes, announcement.
3. "goal" is what the post should make the reader do or feel, in one sentence, tied to the funnel role.
4. Use the platform names exactly as given. When several platforms are listed, pick the best one per slot and cover all of them over the month.

OUTPUT
Return ONLY a JSON object (no markdown fences):
{"items":[{"date":"YYYY-MM-DD","platform":"LINKEDIN","title":"...","idea":"...","goal":"...","format":"...","funnel":"awareness|trust|offer"}]}`;
}

async function planningInstructions(organizationId: string, platforms: string[]): Promise<string | undefined> {
  const rows = await prisma.organizationSkill.findMany({
    where: { organizationId, enabled: true },
    select: { slug: true, name: true, description: true, instructions: true, autoApply: true },
  });
  const cards = rows
    .map(toSkillCard)
    .filter((c) => PLANNING_SKILL_HINT.test(`${c.name} ${c.description}`))
    .filter((c) => c.platforms.length === 0 || c.platforms.some((p) => platforms.includes(p)));
  if (cards.length === 0) return undefined;
  return cards.map((c) => `## Skill: ${c.name}\n${c.instructions.slice(0, 12_000)}`).join("\n\n");
}

function toView(row: {
  id: string;
  name: string | null;
  status: string;
  theme: string;
  audience: string | null;
  platforms: Platform[];
  startDate: Date;
  days: number;
  items: Prisma.JsonValue;
  createdAt: Date;
}): ContentPlanView {
  const parsed = z.array(planItemSchema).safeParse(row.items);
  return {
    id: row.id,
    name: row.name ?? planName(row.theme),
    status: row.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    theme: row.theme,
    audience: row.audience,
    platforms: row.platforms,
    startDate: row.startDate.toISOString().slice(0, 10),
    days: row.days,
    items: parsed.success ? parsed.data : [],
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every plan, newest first, with what each started campaign is up to. */
export async function listPlans(organizationId: string, take = 50): Promise<ContentPlanView[]> {
  const rows = await prisma.contentPlan.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take });
  const views = rows.map(toView);
  const runIds = [...new Set(views.flatMap((p) => p.items.flatMap((i) => (i.runId ? [i.runId] : []))))];
  if (runIds.length === 0) return views;
  const runs = await prisma.agentRun.findMany({ where: { id: { in: runIds }, organizationId }, select: { id: true, status: true } });
  const statusOf = new Map(runs.map((r) => [r.id, r.status as string]));
  return views.map((p) => ({
    ...p,
    items: p.items.map((i) => (i.runId && statusOf.has(i.runId) ? { ...i, runStatus: statusOf.get(i.runId) } : i)),
  }));
}

/** Rename, archive or restore a plan. */
export async function updatePlan(ctx: OrgContext, planId: string, input: PlanUpdateInput): Promise<ContentPlanView> {
  const organizationId = ctx.organization.id;
  const existing = await prisma.contentPlan.findFirst({ where: { id: planId, organizationId }, select: { id: true } });
  if (!existing) throw notFound("Plan");
  const row = await prisma.contentPlan.update({
    where: { id: planId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  await audit(ctx, "plan.update", "ContentPlan", planId, { ...input });
  return toView(row);
}

/** Removes the plan record. Campaigns started from it are untouched. */
export async function deletePlan(ctx: OrgContext, planId: string): Promise<void> {
  const organizationId = ctx.organization.id;
  const existing = await prisma.contentPlan.findFirst({ where: { id: planId, organizationId }, select: { id: true, name: true, theme: true } });
  if (!existing) throw notFound("Plan");
  await prisma.contentPlan.delete({ where: { id: planId } });
  await audit(ctx, "plan.delete", "ContentPlan", planId, { name: existing.name ?? planName(existing.theme) });
}

/** Asks the model for the month and stores it. */
export async function createPlan(ctx: OrgContext, input: PlanInput): Promise<ContentPlanView> {
  const organizationId = ctx.organization.id;
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId, id: { in: [...new Set(input.socialAccountIds)] }, status: "CONNECTED" },
    select: { id: true, platform: true },
  });
  if (accounts.length === 0) throw badRequest("Pick at least one connected account");
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const dates = spreadDates(input.startDate, input.days, input.postsPerWeek);
  const slots = dates.map((date, i) => ({ date, funnel: funnelFor(i, dates.length) }));
  const [ai, brand, stories, instructions] = await Promise.all([
    aiRuntime(organizationId, ctx.user.id),
    brandContext(organizationId, undefined, input.theme),
    storiesForWriters(organizationId),
    planningInstructions(organizationId, platforms),
  ]);
  const system = planPrompt({
    theme: input.theme,
    audience: input.audience,
    platforms,
    slots,
    brand: brand ? { name: brand.name ?? "Brand", industry: brand.industry, tone: brand.tone } : undefined,
    stories,
  });
  const res = await ai.executor.text(await ai.routing("json"), {
    messages: [
      { role: "system", content: instructions ? `${system}\n\n===== SKILL INSTRUCTIONS (follow these) =====\n${instructions}\n===== END SKILL INSTRUCTIONS =====` : system },
      { role: "user", content: "Plan the month now. Return only the JSON object." },
    ],
    json: true,
    temperature: 0.7,
    maxTokens: PLAN_OUTPUT_TOKENS,
    operation: "CALENDAR",
  });
  const { items } = parseJsonOutput(PlanOutputSchema, res.text);
  const allowed = new Set<string>(platforms);
  const cleaned = items
    .filter((i) => allowed.has(i.platform))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_ITEMS);
  if (cleaned.length === 0) throw badRequest("The planner returned nothing usable; try a more specific theme");
  const row = await prisma.contentPlan.create({
    data: {
      organizationId,
      createdById: ctx.user.id,
      name: input.name ?? null,
      theme: input.theme,
      audience: input.audience ?? null,
      platforms,
      startDate: new Date(`${input.startDate}T00:00:00Z`),
      days: input.days,
      items: cleaned as Prisma.InputJsonValue,
    },
  });
  await audit(ctx, "plan.create", "ContentPlan", row.id, { items: cleaned.length, platforms });
  return toView(row);
}

/**
 * Starts one item as a campaign for the accounts on that platform; the run
 * publishes on the item's date once approved. Records the run on the item.
 */
export async function startPlanItem(ctx: OrgContext, planId: string, index: number): Promise<AgentRunDetail> {
  const organizationId = ctx.organization.id;
  const row = await prisma.contentPlan.findFirst({ where: { id: planId, organizationId } });
  if (!row) throw notFound("Plan");
  const plan = toView(row);
  const item = plan.items[index];
  if (!item) throw badRequest("No such item");
  if (item.runId) throw badRequest("This item was already started");
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId, status: "CONNECTED", platform: item.platform as Platform },
    select: { id: true },
  });
  if (accounts.length === 0) throw badRequest(`No connected ${item.platform} account`);
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
  const scheduledAt = new Date(`${item.date}T${String(PUBLISH_HOUR).padStart(2, "0")}:00:00Z`);
  const run = await createRun(ctx, {
    topic: `${item.title}. ${item.idea}`.slice(0, 500),
    goal: item.goal,
    ...(plan.audience ? { audience: plan.audience } : {}),
    notes: `Part of the plan "${plan.theme}" (${item.funnel} stage, ${item.format}).`,
    socialAccountIds: accounts.map((a) => a.id),
    ...(scheduledAt.getTime() > Date.now() ? { scheduledAt: scheduledAt.toISOString() } : {}),
    ...(settings?.timezone ? { timezone: settings.timezone } : {}),
  });
  const items = plan.items.map((it, i) => (i === index ? { ...it, runId: run.id } : it));
  await prisma.contentPlan.update({ where: { id: planId }, data: { items: items as Prisma.InputJsonValue } });
  await audit(ctx, "plan.item.start", "ContentPlan", planId, { index, runId: run.id });
  return run;
}
