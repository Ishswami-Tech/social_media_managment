import { z } from "zod";

/**
 * Skills are research/content playbooks: a system prompt that tells the agent
 * how to use its tools, and a schema for the brief it must return. New skills
 * are added here (or later from a per-organization table) without touching
 * the agent or the UI.
 */
export const BriefSchema = z.object({
  title: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()).default([]),
  angles: z.array(z.object({ hook: z.string(), why: z.string() })).default([]),
  postIdeas: z
    .array(z.object({ platform: z.string(), text: z.string(), hashtags: z.array(z.string()).default([]) }))
    .default([]),
  sources: z.array(z.object({ title: z.string(), url: z.string(), note: z.string().optional() })).default([]),
  caveats: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof BriefSchema>;

export interface Skill {
  id: string;
  name: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  /** Tools this skill should have access to */
  tools: ("web_search" | "read_url" | "read_feed" | "brand_knowledge" | "recent_posts_performance")[];
  needsSearch: boolean;
  maxSteps: number;
  system: (input: { brand?: string; platforms: string[] }) => string;
  user: (input: string, platforms: string[]) => string;
}

const OUTPUT = `Return ONLY a JSON object with this shape:
{"title": "...", "summary": "2-4 paragraphs", "keyPoints": ["..."], "angles": [{"hook": "...", "why": "..."}], "postIdeas": [{"platform": "LINKEDIN", "text": "...", "hashtags": ["#..."]}], "sources": [{"title": "...", "url": "...", "note": "..."}], "caveats": ["..."]}
Every factual claim must come from a source you actually read or searched; list those sources with their real URLs. Never invent URLs, statistics or quotes. If you could not verify something, say so in caveats.`;

const base = (role: string, brand?: string) =>
  `You are ${role} working inside a social media publishing platform${brand ? ` for the brand "${brand}"` : ""}. You have tools: use web_search to find recent material, read_url to read the best results in full, read_feed for RSS/Atom feeds, brand_knowledge for facts about the brand, and recent_posts_performance to learn what this audience engages with. Think in steps: search, read 2-4 of the most relevant pages, then write. Be concrete and specific.`;

export const SKILLS: Skill[] = [
  {
    id: "topic-research",
    name: "Topic research",
    description: "Search the web, read the best sources and produce a sourced brief with angles and post ideas.",
    inputLabel: "Topic or question",
    inputPlaceholder: "e.g. Specialty coffee subscription trends in Europe 2026",
    tools: ["web_search", "read_url", "brand_knowledge", "recent_posts_performance"],
    needsSearch: true,
    maxSteps: 6,
    system: ({ brand }) => `${base("a senior content researcher", brand)}\n${OUTPUT}`,
    user: (input, platforms) =>
      `Research this topic and prepare a content brief with post ideas for ${platforms.join(", ")}:\n\n${input}`,
  },
  {
    id: "url-to-posts",
    name: "URL to posts",
    description:
      "Read an article, blog post or announcement and turn it into platform-ready posts with the key takeaways.",
    inputLabel: "URL",
    inputPlaceholder: "https://example.com/blog/our-new-feature",
    tools: ["read_url", "brand_knowledge"],
    needsSearch: false,
    maxSteps: 3,
    system: ({ brand }) =>
      `${base("a content repurposing specialist", brand)}\nRead the URL with read_url first. Summarise faithfully; do not add claims that are not in the source.\n${OUTPUT}`,
    user: (input, platforms) =>
      `Turn this page into posts for ${platforms.join(", ")}. Include the link as a source.\n\n${input}`,
  },
  {
    id: "competitor-watch",
    name: "Competitor watch",
    description: "Find what a competitor has announced or been covered for recently and suggest how to respond.",
    inputLabel: "Competitor name (and site if known)",
    inputPlaceholder: "e.g. Blue Bottle Coffee, bluebottlecoffee.com",
    tools: ["web_search", "read_url", "read_feed", "brand_knowledge"],
    needsSearch: true,
    maxSteps: 6,
    system: ({ brand }) =>
      `${base("a competitive intelligence analyst", brand)}\nFocus on the last 90 days: launches, campaigns, pricing, press. In angles, suggest how our brand can respond without naming the competitor negatively.\n${OUTPUT}`,
    user: (input, platforms) =>
      `Competitor: ${input}\nPrepare a watch brief and response ideas for ${platforms.join(", ")}.`,
  },
  {
    id: "trend-scan",
    name: "Trend scan",
    description: "Scan recent news and discussions in an industry and surface trends worth posting about this week.",
    inputLabel: "Industry or niche",
    inputPlaceholder: "e.g. independent coffee roasters",
    tools: ["web_search", "read_url", "read_feed", "recent_posts_performance"],
    needsSearch: true,
    maxSteps: 6,
    system: ({ brand }) =>
      `${base("a trend analyst", brand)}\nUse freshness filters (week or month). Prefer primary sources and reputable trade press. Each key point should name the trend and why it matters now.\n${OUTPUT}`,
    user: (input, platforms) =>
      `Industry: ${input}\nWhat is trending right now, and what should we post about it on ${platforms.join(", ")}?`,
  },
  {
    id: "feed-digest",
    name: "Feed digest",
    description: "Read an RSS/Atom feed (your blog, a news site) and turn the latest items into a post series.",
    inputLabel: "Feed URL",
    inputPlaceholder: "https://example.com/feed.xml",
    tools: ["read_feed", "read_url", "brand_knowledge"],
    needsSearch: false,
    maxSteps: 5,
    system: ({ brand }) =>
      `${base("an editorial assistant", brand)}\nRead the feed, then read the 2-3 most relevant items in full before writing.\n${OUTPUT}`,
    user: (input, platforms) => `Feed: ${input}\nDigest the latest items into posts for ${platforms.join(", ")}.`,
  },
];

export function getSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}
