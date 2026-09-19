import type { BrandContext, GenerationTarget } from "@platform/ai-core";
import type { Platform } from "@platform/types";
import { LINKEDIN_CAPABILITIES } from "@platform/social-linkedin";
import { FACEBOOK_CAPABILITIES, INSTAGRAM_CAPABILITIES } from "@platform/social-meta";
import { prisma } from "../db";

const LIMITS: Record<Platform, { maxLength: number; supportsHashtags: boolean }> = {
  LINKEDIN: { maxLength: LINKEDIN_CAPABILITIES.text.maxLength, supportsHashtags: true },
  FACEBOOK: { maxLength: FACEBOOK_CAPABILITIES.text.maxLength, supportsHashtags: true },
  INSTAGRAM: { maxLength: INSTAGRAM_CAPABILITIES.text.maxLength, supportsHashtags: true },
  X: { maxLength: 280, supportsHashtags: true },
  TIKTOK: { maxLength: 2200, supportsHashtags: true },
  YOUTUBE: { maxLength: 5000, supportsHashtags: true },
  THREADS: { maxLength: 500, supportsHashtags: true },
  PINTEREST: { maxLength: 500, supportsHashtags: false },
};

export function targetsFor(platforms: Platform[]): GenerationTarget[] {
  return platforms.map((p) => ({ platform: p, ...LIMITS[p] }));
}

/**
 * Loads brand voice + a small keyword-matched slice of the knowledge base
 * (spec §12). Retrieval stays inside the organization at every step.
 */
export async function brandContext(
  organizationId: string,
  brandId?: string,
  query?: string,
): Promise<BrandContext | undefined> {
  const brand = brandId
    ? await prisma.brand.findFirst({ where: { id: brandId, organizationId } })
    : ((await prisma.brand.findFirst({ where: { organizationId, isDefault: true } })) ??
      (await prisma.brand.findFirst({ where: { organizationId } })));
  if (!brand) return undefined;
  let knowledge: string[] = [];
  if (query) {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3)
      .slice(0, 8);
    if (terms.length) {
      const rows = await prisma.brandKnowledge.findMany({
        where: {
          brandId: brand.id,
          OR: terms.map((t) => ({ content: { contains: t, mode: "insensitive" as const } })),
        },
        take: 6,
        select: { content: true },
      });
      knowledge = rows.map((r) => r.content.slice(0, 800));
    }
  }
  const rules = (brand.rules as BrandContext["rules"] | null) ?? undefined;
  return {
    name: brand.name,
    industry: brand.industry ?? undefined,
    audience: brand.audience ?? undefined,
    tone: brand.tone ?? undefined,
    language: brand.language,
    rules,
    voiceExamples: brand.voiceExamples,
    knowledge,
  };
}
