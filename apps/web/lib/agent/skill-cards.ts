/**
 * Turns the organization's stored skills into the catalogue the Agent Council
 * picks from. A skill names its platform in its own words ("LinkedIn post
 * writer"), so the platforms it applies to are inferred from its name and
 * description; a skill that names none applies everywhere.
 */
import type { SkillCard } from "@platform/agent-council";
import { CUSTOM_SKILL_PREFIX } from "@platform/research";
import { PLATFORMS, type Platform } from "@platform/types";

/** Words a skill uses for each platform; matched as whole words, case-insensitive. */
const PLATFORM_WORDS: Readonly<Record<Platform, readonly string[]>> = {
  LINKEDIN: ["linkedin"],
  FACEBOOK: ["facebook", "fb"],
  INSTAGRAM: ["instagram", "insta", "ig"],
  THREADS: ["threads"],
  X: ["twitter", "x.com", "tweet", "tweets"],
  TIKTOK: ["tiktok"],
  YOUTUBE: ["youtube"],
  PINTEREST: ["pinterest"],
};

function mentions(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

/** Platforms a skill is written for, from its name and description; empty when it names none. */
export function inferSkillPlatforms(name: string, description: string): Platform[] {
  const text = `${name} ${description}`;
  return PLATFORMS.filter((platform) => PLATFORM_WORDS[platform].some((word) => mentions(text, word)));
}

export interface StoredSkill {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  autoApply: boolean;
}

export function toSkillCard(row: StoredSkill): SkillCard {
  return {
    id: `${CUSTOM_SKILL_PREFIX}${row.slug}`,
    name: row.name,
    description: row.description,
    platforms: inferSkillPlatforms(row.name, row.description),
    always: row.autoApply,
    instructions: row.instructions,
  };
}
