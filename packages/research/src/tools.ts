import type { Tool } from "@platform/ai-core";
import { readFeed, readUrl, type SearchConnector } from "./connectors";

export interface ToolContext {
  /** Search connector chosen for the organization (BYO or platform); undefined when none is configured */
  search?: SearchConnector;
  /** Organization-local knowledge lookup */
  brandKnowledge?: (query: string) => Promise<{ title?: string; content: string }[]>;
  /** Organization-local performance data */
  recentPosts?: (
    limit: number,
  ) => Promise<{ platform: string; text: string; publishedAt?: string; metrics?: Record<string, number> }[]>;
  fetchImpl?: typeof fetch;
}

/**
 * The plugin set exposed to the research agent. Every tool is scoped to the
 * calling organization through the injected context; nothing here reaches
 * another tenant's data.
 */
export function buildResearchTools(ctx: ToolContext): Tool[] {
  const tools: Tool[] = [];
  if (ctx.search) {
    const s = ctx.search;
    tools.push({
      definition: {
        name: "web_search",
        description:
          "Search the public web for recent, relevant pages. Use specific queries; call again with different wording if results are weak.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            freshness: {
              type: "string",
              enum: ["day", "week", "month", "year"],
              description: "Restrict to recent results",
            },
          },
          required: ["query"],
        },
      },
      run: async (args) =>
        s.search(String(args.query ?? ""), {
          maxResults: 6,
          freshness: args.freshness as "day" | "week" | "month" | "year" | undefined,
        }),
    });
  }
  tools.push({
    definition: {
      name: "read_url",
      description:
        "Fetch a public web page and return its readable text (article body). Use it on promising search results or URLs the user provided.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
    run: async (args) => {
      const page = await readUrl(String(args.url ?? ""), { fetchImpl: ctx.fetchImpl, maxChars: 12_000 });
      return {
        title: page.title,
        url: page.url,
        siteName: page.siteName,
        publishedAt: page.publishedAt,
        text: page.text,
      };
    },
  });
  tools.push({
    definition: {
      name: "read_feed",
      description: "Read an RSS or Atom feed (news site, blog, competitor updates) and list its latest items.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
    run: async (args) => readFeed(String(args.url ?? ""), { fetchImpl: ctx.fetchImpl, max: 15 }),
  });
  if (ctx.brandKnowledge) {
    const bk = ctx.brandKnowledge;
    tools.push({
      definition: {
        name: "brand_knowledge",
        description:
          "Look up the organization's own knowledge base (products, FAQs, offers, positioning). Prefer this for facts about the brand itself.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      run: async (args) => bk(String(args.query ?? "")),
    });
  }
  if (ctx.recentPosts) {
    const rp = ctx.recentPosts;
    tools.push({
      definition: {
        name: "recent_posts_performance",
        description:
          "List the organization's recently published posts with engagement metrics, to learn what resonates with this audience.",
        parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 30 } } },
      },
      run: async (args) => rp(Math.min(30, Number(args.limit ?? 10) || 10)),
    });
  }
  return tools;
}
