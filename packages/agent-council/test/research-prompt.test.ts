import { describe, expect, it } from "vitest";
import { renderPrompt } from "../src/prompts";
import { toolGuide } from "../src/stages/research";

const tool = (name: string, description = "custom tool") => ({ definition: { name, description } });

describe("research tool guide", () => {
  it("lists only the tools that exist and tells the model there is no web search when none is wired", () => {
    const guide = toolGuide([tool("read_url"), tool("brand_knowledge")]);
    expect(guide).toContain("read_url:");
    expect(guide).toContain("brand_knowledge:");
    expect(guide).not.toMatch(/^- web_search/m);
    expect(guide).toContain("There is no web search");
  });

  it("describes web search when a connector is present and passes plugin tools through with their own description", () => {
    const guide = toolGuide([tool("web_search"), tool("crm_lookup", "Look up a customer in the CRM")]);
    expect(guide).toContain("web_search: search the public web");
    expect(guide).toContain("crm_lookup: Look up a customer in the CRM");
    expect(guide).not.toContain("There is no web search");
  });

  it("explains the empty case", () => {
    expect(toolGuide([])).toContain("No tools are available");
  });

  it("renders the guide into the research prompt instead of a fixed tool list", () => {
    const system = renderPrompt("research", {
      brandClause: "",
      toolGuide: toolGuide([tool("read_url")]),
      topic: "t",
      goal: "g",
      audience: "a",
      notes: "n",
      platforms: "LINKEDIN",
    });
    expect(system).toContain("Only call tools from this list");
    expect(system).toContain("- read_url:");
    expect(system).not.toContain("Use your tools: web_search");
  });
});
