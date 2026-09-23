/**
 * Web search through Gemini's built-in Google Search grounding
 * (https://ai.google.dev/gemini-api/docs/google-search). A Gemini key is all
 * an organization needs: the model runs the search server-side and returns
 * the pages it grounded on, which we expose as ordinary search results.
 */
import type { SearchConnector, SearchResult } from "./connectors";

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MAX_RESULTS = 6;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SNIPPET_CHARS = 400;

/** Grounding hands back redirect links on this host; the real page address sits behind one redirect. */
const REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const REDIRECT_TIMEOUT_MS = 5_000;

const FRESHNESS_HINT: Record<string, string> = {
  day: "from the last 24 hours",
  week: "from the last 7 days",
  month: "from the last month",
  year: "from the last year",
};

interface GroundedResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
      groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
    };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export interface GeminiSearchOptions {
  apiKey: string;
  /** Gemini model that supports the `google_search` tool (discovered from the account, never hard-coded here). */
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Turns grounding metadata into one result per source page, snippets taken from the supported segments. */
export function groundingToResults(data: GroundedResponse, maxResults: number): SearchResult[] {
  const candidate = data.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const supports = candidate?.groundingMetadata?.groundingSupports ?? [];
  const results = chunks.flatMap((chunk, index) => {
    const uri = chunk.web?.uri;
    if (!uri) return [];
    const snippet = supports
      .filter((s) => s.groundingChunkIndices?.includes(index))
      .map((s) => s.segment?.text?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .slice(0, MAX_SNIPPET_CHARS);
    return [{ title: chunk.web?.title ?? uri, url: uri, snippet, source: "google_search" }];
  });
  const unique = results.filter((r, i) => results.findIndex((o) => o.url === r.url) === i);
  return unique.slice(0, maxResults);
}

/**
 * Replaces a grounding redirect link with the page it points to, so writers
 * cite the real address. Best effort: the redirect link is kept on any failure.
 */
export async function resolveRedirect(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return url;
  }
  if (host !== REDIRECT_HOST) return url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: controller.signal });
    const location = res.headers.get("location");
    return location && /^https?:\/\//i.test(location) ? location : url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

export class GeminiSearchConnector implements SearchConnector {
  readonly id = "GEMINI" as const;
  constructor(private readonly opts: GeminiSearchOptions) {}

  async search(query: string, opts: { maxResults?: number; freshness?: string } = {}): Promise<SearchResult[]> {
    const hint = opts.freshness ? FRESHNESS_HINT[opts.freshness] : undefined;
    const prompt = `Search the web and list the most relevant, reputable sources${hint ? ` ${hint}` : ""} for: ${query}\nSummarise what each source says in one or two sentences.`;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${this.opts.baseUrl ?? DEFAULT_BASE}/models/${this.opts.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Gemini search responded ${res.status}: ${text.slice(0, 200)}`);
      const data = JSON.parse(text) as GroundedResponse;
      if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the search: ${data.promptFeedback.blockReason}`);
      const results = groundingToResults(data, opts.maxResults ?? DEFAULT_MAX_RESULTS);
      return Promise.all(results.map(async (r) => ({ ...r, url: await resolveRedirect(r.url, fetchImpl) })));
    } finally {
      clearTimeout(timer);
    }
  }
}
