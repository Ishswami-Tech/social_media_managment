/**
 * AI memory: what the agents know about each account (the Account Brain) and
 * the organization's story bank (facts, anecdotes and numbers the writers may
 * draw from). People can read, correct and extend it; the learning loop keeps
 * writing the parts it owns (performance, human feedback).
 */
import { z } from "zod";
import type { AccountBrain } from "@platform/agent-council";
import type { Prisma } from "@platform/database";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";

export const STORY_SOURCE_TYPE = "STORY";
const MAX_LIST_ITEMS = 40;
const MAX_ITEM_CHARS = 300;
const MAX_STORIES_FOR_WRITERS = 12;

const list = z.array(z.string().trim().min(1).max(MAX_ITEM_CHARS)).max(MAX_LIST_ITEMS).default([]);
const text = z.string().trim().max(MAX_ITEM_CHARS).optional();

export const memoryInput = z.object({
  identity: z.object({ brand: text, industry: text, positioning: text, products: list }).default({ products: [] }),
  audience: z.object({ personas: list, painPoints: list, desiredOutcomes: list }).default({ personas: [], painPoints: [], desiredOutcomes: [] }),
  voice: z
    .object({ tone: text, sentenceStyle: text, vocabulary: list, forbiddenLanguage: list, examples: z.array(z.string().trim().min(1).max(3000)).max(10).default([]) })
    .default({ vocabulary: [], forbiddenLanguage: [], examples: [] }),
  content: z
    .object({ pillars: list, topics: list, formats: list, ctaPreferences: list, forbiddenTopics: list })
    .default({ pillars: [], topics: [], formats: [], ctaPreferences: [], forbiddenTopics: [] }),
});
export type MemoryInput = z.infer<typeof memoryInput>;

export const storyInput = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(3).max(4000),
});

export interface Story {
  id: string;
  title: string | null;
  content: string;
  createdAt: string;
}

export interface AccountMemory {
  account: { id: string; platform: string; displayName: string };
  editable: MemoryInput;
  learned: NonNullable<AccountBrain["performance"]> | null;
  learnedAt: string | null;
  feedback: NonNullable<NonNullable<AccountBrain["humanFeedback"]>["preferences"]>;
}

function asBrain(profile: {
  identity: Prisma.JsonValue | null;
  audience: Prisma.JsonValue | null;
  voice: Prisma.JsonValue | null;
  content: Prisma.JsonValue | null;
  performance: Prisma.JsonValue | null;
  humanFeedback: Prisma.JsonValue | null;
} | null): AccountBrain {
  if (!profile) return {};
  const obj = (v: Prisma.JsonValue | null) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  return {
    identity: obj(profile.identity) as AccountBrain["identity"],
    audience: obj(profile.audience) as AccountBrain["audience"],
    voice: obj(profile.voice) as AccountBrain["voice"],
    content: obj(profile.content) as AccountBrain["content"],
    performance: obj(profile.performance) as AccountBrain["performance"],
    humanFeedback: obj(profile.humanFeedback) as AccountBrain["humanFeedback"],
  };
}

/** The editable slice of a brain, with every list present so forms can render it. */
export function editableMemory(brain: AccountBrain): MemoryInput {
  return memoryInput.parse({
    identity: { ...brain.identity, products: brain.identity?.products ?? [] },
    audience: {
      personas: brain.audience?.personas ?? [],
      painPoints: brain.audience?.painPoints ?? [],
      desiredOutcomes: brain.audience?.desiredOutcomes ?? [],
    },
    voice: {
      tone: brain.voice?.tone,
      sentenceStyle: brain.voice?.sentenceStyle,
      vocabulary: brain.voice?.vocabulary ?? [],
      forbiddenLanguage: brain.voice?.forbiddenLanguage ?? [],
      examples: brain.voice?.examples ?? [],
    },
    content: {
      pillars: brain.content?.pillars ?? [],
      topics: brain.content?.topics ?? [],
      formats: brain.content?.formats ?? [],
      ctaPreferences: brain.content?.ctaPreferences ?? [],
      forbiddenTopics: brain.content?.forbiddenTopics ?? [],
    },
  });
}

export async function listAccountMemories(organizationId: string): Promise<AccountMemory[]> {
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId, status: "CONNECTED" },
    orderBy: [{ platform: "asc" }, { displayName: "asc" }],
    include: { profile: true },
  });
  return accounts.map((a) => {
    const brain = asBrain(a.profile);
    return {
      account: { id: a.id, platform: a.platform, displayName: a.displayName },
      editable: editableMemory(brain),
      learned: brain.performance ?? null,
      learnedAt: a.profile?.learnedAt?.toISOString() ?? null,
      feedback: brain.humanFeedback?.preferences ?? [],
    };
  });
}

export async function saveAccountMemory(ctx: OrgContext, accountId: string, input: MemoryInput): Promise<void> {
  const organizationId = ctx.organization.id;
  const account = await prisma.socialAccount.findFirst({ where: { id: accountId, organizationId }, select: { id: true } });
  if (!account) throw notFound("Account");
  const data = {
    identity: input.identity as Prisma.InputJsonValue,
    audience: input.audience as Prisma.InputJsonValue,
    voice: input.voice as Prisma.InputJsonValue,
    content: input.content as Prisma.InputJsonValue,
  };
  await prisma.accountProfile.upsert({
    where: { socialAccountId: accountId },
    create: { organizationId, socialAccountId: accountId, ...data },
    update: data,
  });
  await audit(ctx, "memory.account.update", "AccountProfile", accountId, { fields: Object.keys(data) });
}

/** Drops one learned preference (by its position in the list) so the writers stop following it. */
export async function forgetPreference(ctx: OrgContext, accountId: string, index: number): Promise<void> {
  const profile = await prisma.accountProfile.findFirst({
    where: { socialAccountId: accountId, organizationId: ctx.organization.id },
    select: { id: true, humanFeedback: true },
  });
  if (!profile) throw notFound("Account memory");
  const brain = asBrain({ identity: null, audience: null, voice: null, content: null, performance: null, humanFeedback: profile.humanFeedback });
  const preferences = brain.humanFeedback?.preferences ?? [];
  if (index < 0 || index >= preferences.length) throw badRequest("No such preference");
  const remaining = preferences.filter((_, i) => i !== index);
  await prisma.accountProfile.update({
    where: { id: profile.id },
    data: { humanFeedback: { preferences: remaining } as Prisma.InputJsonValue },
  });
  await audit(ctx, "memory.preference.forget", "AccountProfile", profile.id, { index });
}

async function defaultBrandId(organizationId: string, createdIfMissing: boolean): Promise<string | null> {
  const brand =
    (await prisma.brand.findFirst({ where: { organizationId, isDefault: true }, select: { id: true } })) ??
    (await prisma.brand.findFirst({ where: { organizationId }, select: { id: true } }));
  if (brand) return brand.id;
  if (!createdIfMissing) return null;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const created = await prisma.brand.create({ data: { organizationId, name: org?.name ?? "Brand", isDefault: true }, select: { id: true } });
  return created.id;
}

export async function listStories(organizationId: string): Promise<Story[]> {
  const brandId = await defaultBrandId(organizationId, false);
  if (!brandId) return [];
  const rows = await prisma.brandKnowledge.findMany({
    where: { brandId, sourceType: STORY_SOURCE_TYPE },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, content: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** The newest stories, as the writers see them inside every Account Brain. */
export async function storiesForWriters(organizationId: string): Promise<{ title?: string; text: string }[]> {
  const stories = await listStories(organizationId);
  return stories.slice(0, MAX_STORIES_FOR_WRITERS).map((s) => ({ ...(s.title ? { title: s.title } : {}), text: s.content }));
}

export async function addStory(ctx: OrgContext, input: z.infer<typeof storyInput>): Promise<Story> {
  const brandId = await defaultBrandId(ctx.organization.id, true);
  if (!brandId) throw badRequest("No brand to attach the story to");
  const row = await prisma.brandKnowledge.create({
    data: {
      brandId,
      sourceType: STORY_SOURCE_TYPE,
      sourceKey: `story:${Date.now()}`,
      title: input.title || null,
      content: input.content,
    },
    select: { id: true, title: true, content: true, createdAt: true },
  });
  await audit(ctx, "memory.story.add", "BrandKnowledge", row.id, { title: row.title });
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export async function deleteStory(ctx: OrgContext, id: string): Promise<void> {
  const row = await prisma.brandKnowledge.findFirst({
    where: { id, sourceType: STORY_SOURCE_TYPE, brand: { organizationId: ctx.organization.id } },
    select: { id: true },
  });
  if (!row) throw notFound("Story");
  await prisma.brandKnowledge.delete({ where: { id } });
  await audit(ctx, "memory.story.delete", "BrandKnowledge", id, {});
}
