import { describe, expect, it } from "vitest";
import { companionData, customSkill, parseGitHubUrl, parseSkillMarkdown, slugifySkillName } from "../src/custom-skills";

/**
 * A skill that says "read hooks.json in this folder" is useless if the import
 * leaves hooks.json behind: the model is handed an instruction to open a file
 * it will never see. These cover which neighbours come with it.
 */
describe("data a skill keeps beside itself", () => {
  const files = new Set([
    "skills/li-post/SKILL.md",
    "skills/li-post/hooks.json",
    "skills/li-post/notes.json",
    "skills/li-human/slop.json",
    "top-level.json",
  ]);

  it("takes a file the skill names in backticks", () => {
    expect(companionData("Read `hooks.json` in this folder.", "skills/li-post", files)).toEqual(["skills/li-post/hooks.json"]);
  });

  it("takes one named as a link or a relative path", () => {
    expect(companionData("See [the hooks](./hooks.json).", "skills/li-post", files)).toEqual(["skills/li-post/hooks.json"]);
    expect(companionData("Load skills/li-post/hooks.json first.", "skills/li-post", files)).toEqual(["skills/li-post/hooks.json"]);
  });

  it("leaves neighbours the skill never mentions", () => {
    expect(companionData("Just write the post.", "skills/li-post", files)).toEqual([]);
    // notes.json sits in the folder but is not named, so it stays behind.
    expect(companionData("Read `hooks.json`.", "skills/li-post", files)).not.toContain("skills/li-post/notes.json");
  });

  it("does not reach outside the skill's own folder", () => {
    expect(companionData("Read `slop.json` and `top-level.json`.", "skills/li-post", files)).toEqual([]);
  });

  it("ignores names that are not data, and names that do not exist", () => {
    expect(companionData("Run `humanize.py` on it.", "skills/li-human", files)).toEqual([]);
    expect(companionData("Read `missing.json`.", "skills/li-post", files)).toEqual([]);
  });

  it("asks for each file once however often it is named", () => {
    expect(companionData("`hooks.json` and again hooks.json and ./hooks.json", "skills/li-post", files)).toEqual([
      "skills/li-post/hooks.json",
    ]);
  });
});

describe("parseSkillMarkdown", () => {
  it("reads name and description from frontmatter and returns the body", () => {
    const md = `---\nname: linkedin-post-writer\ndescription: "Draft a post, with \\"quotes\\""\n---\n\n# Writer\n\nDo the thing.`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed.name).toBe("linkedin-post-writer");
    expect(parsed.description).toBe('Draft a post, with "quotes"');
    expect(parsed.body).toBe("# Writer\n\nDo the thing.");
  });

  it("treats markdown without frontmatter as the body", () => {
    expect(parseSkillMarkdown("# Just instructions")).toEqual({ body: "# Just instructions" });
  });
});

describe("parseGitHubUrl", () => {
  it("accepts a repository URL", () => {
    expect(parseGitHubUrl("https://github.com/sergebulaev/linkedin-skills")).toEqual({
      owner: "sergebulaev",
      repo: "linkedin-skills",
      path: "",
    });
  });
  it("accepts folder and file URLs", () => {
    expect(parseGitHubUrl("https://github.com/o/r/tree/main/skills")).toEqual({ owner: "o", repo: "r", ref: "main", path: "skills" });
    expect(parseGitHubUrl("https://github.com/o/r/blob/dev/skills/x/SKILL.md")).toEqual({
      owner: "o",
      repo: "r",
      ref: "dev",
      path: "skills/x",
      file: "skills/x/SKILL.md",
    });
    expect(parseGitHubUrl("https://raw.githubusercontent.com/o/r/main/skills/x/SKILL.md").file).toBe("skills/x/SKILL.md");
  });
  it("rejects non-GitHub URLs", () => {
    expect(() => parseGitHubUrl("https://example.com/skill")).toThrow(/GitHub/);
  });
});

describe("customSkill", () => {
  it("embeds the instructions in the system prompt and only offers web_search when a connector exists", () => {
    const def = { slug: "writer", name: "Writer", description: "d", instructions: "Always open with a number." };
    const withSearch = customSkill(def, { hasSearch: true });
    const without = customSkill(def, { hasSearch: false });
    expect(withSearch.id).toBe("custom:writer");
    expect(withSearch.tools).toContain("web_search");
    expect(without.tools).not.toContain("web_search");
    expect(without.needsSearch).toBe(false);
    const system = without.system({ brand: "Acme", platforms: ["LINKEDIN"] });
    expect(system).toContain("Always open with a number.");
    expect(system).toContain('brand "Acme"');
    expect(system).toContain("postIdeas");
  });
  it("slugifies names", () => {
    expect(slugifySkillName("LinkedIn Post Writer!")).toBe("linkedin-post-writer");
  });
});
