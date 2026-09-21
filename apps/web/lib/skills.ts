import { z } from "zod";
import {
  CUSTOM_SKILL_PREFIX,
  customSkill,
  fetchGitHubSkills,
  parseSkillMarkdown,
  SKILLS,
  slugifySkillName,
  type CustomSkillDefinition,
  type Skill,
} from "@platform/research";
import { ApiError, badRequest } from "./errors";
import { audit } from "./audit";
import { prisma } from "./db";
import { resolveSearchConnector } from "./research";
import type { OrgContext } from "./session";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  needsSearch: boolean;
  /** Built-in skills ship with the platform; custom ones belong to the organization. */
  source: "builtin" | "custom";
}

async function customDefinitions(organizationId: string): Promise<CustomSkillDefinition[]> {
  const rows = await prisma.organizationSkill.findMany({
    where: { organizationId, enabled: true },
    orderBy: { name: "asc" },
    select: { slug: true, name: true, description: true, instructions: true, sourceUrl: true },
  });
  return rows.map((r) => ({ ...r, sourceUrl: r.sourceUrl ?? undefined }));
}

/** Built-in skills followed by the organization's enabled custom skills. */
export async function listSkills(organizationId: string): Promise<Skill[]> {
  const [defs, search] = await Promise.all([customDefinitions(organizationId), resolveSearchConnector(organizationId)]);
  return [...SKILLS, ...defs.map((d) => customSkill(d, { hasSearch: !!search }))];
}

export async function listSkillSummaries(organizationId: string): Promise<SkillSummary[]> {
  const skills = await listSkills(organizationId);
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    inputLabel: s.inputLabel,
    inputPlaceholder: s.inputPlaceholder,
    needsSearch: s.needsSearch,
    source: s.id.startsWith(CUSTOM_SKILL_PREFIX) ? "custom" : "builtin",
  }));
}

export async function resolveSkill(organizationId: string, id: string): Promise<Skill | undefined> {
  if (!id.startsWith(CUSTOM_SKILL_PREFIX)) return SKILLS.find((s) => s.id === id);
  const slug = id.slice(CUSTOM_SKILL_PREFIX.length);
  const [row, search] = await Promise.all([
    prisma.organizationSkill.findFirst({
      where: { organizationId, slug, enabled: true },
      select: { slug: true, name: true, description: true, instructions: true, sourceUrl: true },
    }),
    resolveSearchConnector(organizationId),
  ]);
  return row ? customSkill({ ...row, sourceUrl: row.sourceUrl ?? undefined }, { hasSearch: !!search }) : undefined;
}

// ---- management (Settings → Skills) ----

export const importSkillsInput = z.object({ url: z.string().url().max(500) });

export const createSkillInput = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(""),
  /** Either a full SKILL.md (frontmatter is honoured) or plain instructions. */
  markdown: z.string().min(20).max(200_000),
  sourceUrl: z.string().url().max(500).optional(),
});

async function upsertDefinitions(ctx: OrgContext, defs: CustomSkillDefinition[]) {
  const saved = [];
  for (const d of defs) {
    const row = await prisma.organizationSkill.upsert({
      where: { organizationId_slug: { organizationId: ctx.organization.id, slug: d.slug } },
      create: {
        organizationId: ctx.organization.id,
        slug: d.slug,
        name: d.name,
        description: d.description,
        instructions: d.instructions,
        sourceUrl: d.sourceUrl,
        createdById: ctx.user.id,
      },
      update: { name: d.name, description: d.description, instructions: d.instructions, sourceUrl: d.sourceUrl, enabled: true },
      select: { id: true, slug: true, name: true, description: true, sourceUrl: true, enabled: true, updatedAt: true },
    });
    saved.push(row);
  }
  return saved;
}

/** Imports every SKILL.md found at a GitHub repository, folder or file URL. */
export async function importSkillsFromUrl(ctx: OrgContext, url: string) {
  let defs: CustomSkillDefinition[];
  try {
    defs = await fetchGitHubSkills(url);
  } catch (e) {
    throw new ApiError(400, (e as Error).message, "import_failed");
  }
  const saved = await upsertDefinitions(ctx, defs);
  await audit(ctx, "skill.import", "OrganizationSkill", null, { url, count: saved.length, slugs: saved.map((s) => s.slug) });
  return saved;
}

export async function createSkill(ctx: OrgContext, input: z.infer<typeof createSkillInput>) {
  const parsed = parseSkillMarkdown(input.markdown);
  const name = input.name || parsed.name;
  if (!name) throw badRequest("Skill name is required");
  const [saved] = await upsertDefinitions(ctx, [
    {
      slug: slugifySkillName(name),
      name,
      description: input.description || parsed.description || "",
      instructions: parsed.body,
      sourceUrl: input.sourceUrl,
    },
  ]);
  await audit(ctx, "skill.create", "OrganizationSkill", saved!.id, { slug: saved!.slug });
  return saved!;
}

export async function setSkillEnabled(ctx: OrgContext, id: string, enabled: boolean) {
  const row = await prisma.organizationSkill.findFirst({ where: { id, organizationId: ctx.organization.id } });
  if (!row) throw new ApiError(404, "Skill not found", "not_found");
  const updated = await prisma.organizationSkill.update({ where: { id }, data: { enabled }, select: { id: true, enabled: true } });
  await audit(ctx, "skill.toggle", "OrganizationSkill", id, { enabled });
  return updated;
}

export async function deleteSkill(ctx: OrgContext, id: string) {
  const row = await prisma.organizationSkill.findFirst({ where: { id, organizationId: ctx.organization.id } });
  if (!row) throw new ApiError(404, "Skill not found", "not_found");
  await prisma.organizationSkill.delete({ where: { id } });
  await audit(ctx, "skill.delete", "OrganizationSkill", id, { slug: row.slug });
}

export async function listOrganizationSkills(organizationId: string) {
  return prisma.organizationSkill.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      sourceUrl: true,
      enabled: true,
      autoApply: true,
      updatedAt: true,
    },
  });
}

export async function setSkillAutoApply(ctx: OrgContext, id: string, autoApply: boolean) {
  const row = await prisma.organizationSkill.findFirst({ where: { id, organizationId: ctx.organization.id } });
  if (!row) throw new ApiError(404, "Skill not found", "not_found");
  const updated = await prisma.organizationSkill.update({
    where: { id },
    data: { autoApply },
    select: { id: true, autoApply: true },
  });
  await audit(ctx, "skill.auto_apply", "OrganizationSkill", id, { autoApply });
  return updated;
}

/** Total instruction text attached to one AI call; keeps the prompt within a sane size. */
const ATTACHED_SKILLS_MAX_CHARS = 60_000;

export const skillIdsInput = z.array(z.string().min(1).max(120)).max(8).optional();

/**
 * Instructions to inject into an ordinary AI call (generate, rewrite, hashtags,
 * calendar): every enabled skill marked "apply to every AI call" plus any
 * skills the caller attached explicitly. Built-in research skills are agent
 * playbooks and are ignored here.
 */
export async function attachedSkillInstructions(organizationId: string, skillIds: string[] = []): Promise<string | undefined> {
  const slugs = skillIds.filter((id) => id.startsWith(CUSTOM_SKILL_PREFIX)).map((id) => id.slice(CUSTOM_SKILL_PREFIX.length));
  const rows = await prisma.organizationSkill.findMany({
    where: { organizationId, enabled: true, OR: [{ autoApply: true }, ...(slugs.length ? [{ slug: { in: slugs } }] : [])] },
    orderBy: { name: "asc" },
    select: { name: true, instructions: true },
  });
  if (rows.length === 0) return undefined;
  const blocks: string[] = [];
  let budget = ATTACHED_SKILLS_MAX_CHARS;
  for (const r of rows) {
    if (budget <= 0) break;
    const text = r.instructions.slice(0, budget);
    blocks.push(`## Skill: ${r.name}\n${text}`);
    budget -= text.length;
  }
  return blocks.join("\n\n");
}
