/**
 * Research connectors: sources the AI can pull from. Each is a small,
 * dependency-free HTTP client so organizations can bring their own keys.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  publishedAt?: string;
  siteName?: string;
}

export interface FeedItem {
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
}

export type SearchConnectorId = "TAVILY" | "BRAVE" | "GEMINI";

export interface SearchConnector {
  readonly id: SearchConnectorId;
  search(
    query: string,
    opts?: { maxResults?: number; freshness?: "day" | "week" | "month" | "year" },
  ): Promise<SearchResult[]>;
}

/** Connectors that take their own API key (Gemini search rides on the organization's Gemini AI key instead). */
export const CONNECTOR_IDS = ["TAVILY", "BRAVE"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export const CONNECTOR_INFO: Record<SearchConnectorId, { name: string; description: string; docsUrl: string }> = {
  GEMINI: {
    name: "Google Search (Gemini)",
    description: "Google Search grounding through your Gemini key; no extra key needed.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/google-search",
  },
  TAVILY: {
    name: "Tavily",
    description: "Web search built for AI agents; returns cleaned page excerpts.",
    docsUrl: "https://tavily.com",
  },
  BRAVE: {
    name: "Brave Search",
    description: "Independent web index with news freshness filters.",
    docsUrl: "https://brave.com/search/api/",
  },
};

async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class TavilyConnector implements SearchConnector {
  readonly id = "TAVILY" as const;
  constructor(private readonly apiKey: string) {}
  async search(query: string, opts: { maxResults?: number; freshness?: string } = {}): Promise<SearchResult[]> {
    const data = await fetchJson<{
      results?: { title: string; url: string; content: string; published_date?: string }[];
    }>("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 6,
        search_depth: "advanced",
        include_answer: false,
        ...(opts.freshness ? { time_range: opts.freshness } : {}),
      }),
    });
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 600) ?? "",
      publishedAt: r.published_date,
      source: safeHost(r.url),
    }));
  }
}

export class BraveConnector implements SearchConnector {
  readonly id = "BRAVE" as const;
  constructor(private readonly apiKey: string) {}
  async search(query: string, opts: { maxResults?: number; freshness?: string } = {}): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, count: String(opts.maxResults ?? 6) });
    if (opts.freshness)
      params.set("freshness", { day: "pd", week: "pw", month: "pm", year: "py" }[opts.freshness] ?? "");
    const data = await fetchJson<{
      web?: { results?: { title: string; url: string; description?: string; age?: string }[] };
    }>(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { accept: "application/json", "x-subscription-token": this.apiKey },
    });
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
      publishedAt: r.age,
      source: safeHost(r.url),
    }));
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Strip HTML to readable text: drops scripts/styles/nav, keeps headings and paragraphs. */
export function htmlToText(html: string): { title: string; text: string; siteName?: string; publishedAt?: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const meta = (name: string) =>
    decode(
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i").exec(html)?.[1] ?? "",
    );
  const siteName = meta("og:site_name") || undefined;
  const publishedAt = meta("article:published_time") || meta("date") || undefined;
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const main = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2];
  if (main && main.length > 500) body = main;
  const text = decode(
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text, siteName, publishedAt };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};
function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|169\.254\.)/;

/** True when the URL is http(s) and does not point at a private, loopback or link-local host (SSRF guard). */
export function isPublicHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !BLOCKED_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** Fetch and clean a public web page. Refuses private/loopback addresses (SSRF guard). */
export async function readUrl(
  url: string,
  opts: { maxChars?: number; fetchImpl?: typeof fetch } = {},
): Promise<PageContent> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) throw new Error("URL is not allowed");
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await f(u.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SocialAIPlatform/1.0; +research)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${u.host} responded ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const cleaned = type.includes("html")
      ? htmlToText(raw)
      : { title: u.pathname.split("/").pop() ?? u.host, text: raw };
    return {
      url: u.toString(),
      title: cleaned.title || u.host,
      text: cleaned.text.slice(0, opts.maxChars ?? 20_000),
      siteName: cleaned.siteName,
      publishedAt: cleaned.publishedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal RSS 2.0 / Atom parser. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const grab = (block: string, tag: string) =>
    decode(
      new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i").exec(block)?.[1] ?? "",
    ).trim();
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    items.push({
      title: grab(b, "title"),
      url: grab(b, "link") || (/<guid[^>]*>([^<]+)<\/guid>/i.exec(b)?.[1] ?? ""),
      publishedAt: grab(b, "pubDate") || undefined,
      summary:
        grab(b, "description")
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 400) || undefined,
    });
  }
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const b = m[0];
    const link = /<link[^>]+href=["']([^"']+)["']/i.exec(b)?.[1] ?? "";
    items.push({
      title: grab(b, "title"),
      url: link,
      publishedAt: grab(b, "updated") || grab(b, "published") || undefined,
      summary:
        (grab(b, "summary") || grab(b, "content"))
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 400) || undefined,
    });
  }
  return items.filter((i) => i.title || i.url);
}

export async function readFeed(
  url: string,
  opts: { fetchImpl?: typeof fetch; max?: number } = {},
): Promise<FeedItem[]> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) throw new Error("URL is not allowed");
  const res = await (opts.fetchImpl ?? fetch)(u.toString(), {
    headers: {
      "user-agent": "SocialAIPlatform/1.0 feed reader",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error(`${u.host} responded ${res.status}`);
  return parseFeed(await res.text()).slice(0, opts.max ?? 20);
}
