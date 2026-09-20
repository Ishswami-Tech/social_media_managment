import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BraveConnector,
  BriefSchema,
  SKILLS,
  TavilyConnector,
  buildResearchTools,
  getSkill,
  htmlToText,
  parseFeed,
  readUrl,
} from "../src/index";

afterEach(() => vi.unstubAllGlobals());

describe("htmlToText", () => {
  it("extracts title, drops chrome and keeps article text", () => {
    const html = `<html><head><title>Cold brew &amp; more</title><meta property="og:site_name" content="Coffee News"></head>
      <body><nav>Menu</nav><script>evil()</script><article><h1>Cold brew rises</h1><p>Sales grew <b>20%</b> this year.</p><ul><li>Point one</li></ul></article><footer>Copyright</footer></body></html>`;
    const r = htmlToText(html);
    expect(r.title).toBe("Cold brew & more");
    expect(r.siteName).toBe("Coffee News");
    expect(r.text).toContain("Cold brew rises");
    expect(r.text).toContain("Sales grew 20% this year.");
    expect(r.text).toContain("• Point one");
    expect(r.text).not.toContain("Menu");
    expect(r.text).not.toContain("evil");
  });
});

describe("readUrl", () => {
  it("refuses private addresses", async () => {
    await expect(readUrl("http://localhost:3000/x")).rejects.toThrow(/not allowed/);
    await expect(readUrl("http://192.168.1.1/")).rejects.toThrow(/not allowed/);
    await expect(readUrl("ftp://example.com/")).rejects.toThrow(/not allowed/);
  });
  it("fetches and cleans html", async () => {
    const fetchImpl = (async () =>
      new Response("<html><title>T</title><body><p>Hello world</p></body></html>", {
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const page = await readUrl("https://example.com/a", { fetchImpl });
    expect(page.title).toBe("T");
    expect(page.text).toBe("Hello world");
  });
});

describe("parseFeed", () => {
  it("parses RSS and Atom", () => {
    const rss = `<rss><channel><item><title><![CDATA[Post A]]></title><link>https://a</link><pubDate>Mon, 01 Jan 2026</pubDate><description>&lt;p&gt;Desc&lt;/p&gt;</description></item></channel></rss>`;
    const atom = `<feed><entry><title>Entry B</title><link href="https://b"/><updated>2026-01-02</updated><summary>Sum</summary></entry></feed>`;
    expect(parseFeed(rss)).toEqual([
      { title: "Post A", url: "https://a", publishedAt: "Mon, 01 Jan 2026", summary: "Desc" },
    ]);
    expect(parseFeed(atom)[0]).toMatchObject({ title: "Entry B", url: "https://b", summary: "Sum" });
  });
});

describe("search connectors", () => {
  it("Tavily maps results and sends the bearer key", async () => {
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tv-key");
      return new Response(
        JSON.stringify({
          results: [
            { title: "R1", url: "https://news.example.com/x", content: "snippet", published_date: "2026-01-01" },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fn);
    const r = await new TavilyConnector("tv-key").search("q");
    expect(r).toEqual([
      {
        title: "R1",
        url: "https://news.example.com/x",
        snippet: "snippet",
        publishedAt: "2026-01-01",
        source: "news.example.com",
      },
    ]);
  });
  it("Brave maps results and freshness", async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("freshness=pw");
      expect((init?.headers as Record<string, string>)["x-subscription-token"]).toBe("br-key");
      return new Response(
        JSON.stringify({
          web: { results: [{ title: "B", url: "https://b.com", description: "d", age: "2 days ago" }] },
        }),
      );
    });
    vi.stubGlobal("fetch", fn);
    const r = await new BraveConnector("br-key").search("q", { freshness: "week" });
    expect(r[0]).toMatchObject({ title: "B", snippet: "d", source: "b.com" });
  });
});

describe("tools & skills", () => {
  it("exposes only the tools the context provides", () => {
    const none = buildResearchTools({}).map((t) => t.definition.name);
    expect(none).toEqual(["read_url", "read_feed"]);
    const all = buildResearchTools({
      search: { id: "TAVILY", search: async () => [] },
      brandKnowledge: async () => [],
      recentPosts: async () => [],
    }).map((t) => t.definition.name);
    expect(all).toEqual(["web_search", "read_url", "read_feed", "brand_knowledge", "recent_posts_performance"]);
  });
  it("skills produce prompts and the brief schema fills defaults", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(5);
    const s = getSkill("topic-research")!;
    expect(s.system({ brand: "Acme", platforms: ["LINKEDIN"] })).toContain("Acme");
    expect(s.user("coffee", ["LINKEDIN", "INSTAGRAM"])).toContain("LINKEDIN, INSTAGRAM");
    const brief = BriefSchema.parse({ title: "t", summary: "s" });
    expect(brief.sources).toEqual([]);
  });
});
