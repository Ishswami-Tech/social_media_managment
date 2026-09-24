import { describe, expect, it } from "vitest";
import { inferSkillPlatforms, toSkillCard } from "../lib/agent/skill-cards";

describe("inferSkillPlatforms", () => {
  it("reads the platform a skill names in its title or description", () => {
    expect(inferSkillPlatforms("LinkedIn post writer", "Draft a new LinkedIn post")).toEqual(["LINKEDIN"]);
    expect(inferSkillPlatforms("Caption helper", "Write Instagram and TikTok captions")).toEqual(["INSTAGRAM", "TIKTOK"]);
    expect(inferSkillPlatforms("Thread writer", "Turn a blog post into a tweet thread")).toEqual(["X"]);
  });

  it("returns nothing for a general playbook, and does not match inside other words", () => {
    expect(inferSkillPlatforms("House style", "Never open with a question")).toEqual([]);
    expect(inferSkillPlatforms("Big ideas", "Use xylophone-level clarity in exhibits")).toEqual([]);
  });
});

describe("toSkillCard", () => {
  it("builds the catalogue entry with the custom id prefix and the always flag", () => {
    const card = toSkillCard({
      slug: "linkedin-humanizer",
      name: "LinkedIn humanizer",
      description: "Remove AI tells from a LinkedIn post",
      instructions: "# Rules",
      autoApply: true,
    });
    expect(card).toEqual({
      id: "custom:linkedin-humanizer",
      name: "LinkedIn humanizer",
      description: "Remove AI tells from a LinkedIn post",
      platforms: ["LINKEDIN"],
      always: true,
      instructions: "# Rules",
    });
  });
});
