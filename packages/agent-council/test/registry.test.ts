import { describe, expect, it } from "vitest";
import {
  definePrompt,
  getPrompt,
  listPrompts,
  promptHash,
  renderPrompt,
  renderTemplate,
} from "../src/prompts/registry";
import "../src/prompts";

const REQUIRED_KEYS = ["research", "claims", "strategy", "writer", "revision", "judge", "synthesis", "adapt"];

describe("prompt registry", () => {
  it("registers every pipeline prompt at version 1 with a stable sha256 hash", () => {
    const prompts = listPrompts();
    for (const key of REQUIRED_KEYS) {
      const prompt = prompts.find((p) => p.key === key);
      expect(prompt, `prompt "${key}" is missing`).toBeDefined();
      expect(prompt!.version).toBe(1);
      expect(prompt!.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(prompt!.hash).toBe(promptHash(prompt!.key, prompt!.version, prompt!.template));
    }
  });

  it("returns prompts sorted by key with the template for persistence", () => {
    const keys = listPrompts().map((p) => p.key);
    expect(keys).toEqual([...keys].sort());
    expect(listPrompts().every((p) => p.template.length > 200)).toBe(true);
  });

  it("hashes key, version and template together", () => {
    const template = "Hello {{name}}";
    expect(promptHash("a", 1, template)).toBe(promptHash("a", 1, template));
    expect(promptHash("a", 1, template)).not.toBe(promptHash("b", 1, template));
    expect(promptHash("a", 1, template)).not.toBe(promptHash("a", 2, template));
    expect(promptHash("a", 1, template)).not.toBe(promptHash("a", 1, `${template}!`));
  });

  it("is idempotent for the same definition and rejects a changed template on the same version", () => {
    const first = definePrompt("test.stable", 1, "Fixed {{value}}");
    expect(definePrompt("test.stable", 1, "Fixed {{value}}").hash).toBe(first.hash);
    expect(() => definePrompt("test.stable", 1, "Changed {{value}}")).toThrow(/bump the version/);
  });

  it("substitutes {{var}} placeholders and renders unknown variables as empty", () => {
    definePrompt("test.render", 1, "Topic: {{topic}}\nGoal: {{ goal }}\nMissing: [{{nope}}]");
    expect(renderPrompt("test.render", { topic: "coffee", goal: 42 })).toBe(
      "Topic: coffee\nGoal: 42\nMissing: []",
    );
    expect(renderTemplate("{{a}}-{{a}}", { a: "x" })).toBe("x-x");
    expect(renderTemplate("no placeholders", {})).toBe("no placeholders");
  });

  it("renders the writer prompt with its platform limits", () => {
    const rendered = renderPrompt("writer", { platform: "LINKEDIN", maxLength: 3000, maxHashtags: 5 });
    expect(rendered).toContain("LINKEDIN");
    expect(rendered).toContain("at most 3000 characters");
    expect(rendered).not.toContain("{{");
  });

  it("throws for an unknown prompt key", () => {
    expect(() => getPrompt("does-not-exist")).toThrow(/Unknown prompt/);
  });
});
