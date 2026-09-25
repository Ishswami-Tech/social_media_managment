import { AIError } from "./errors";

const DEFAULT_TIMEOUT_MS = 120_000;
/** Streams idle between tokens; give a slow model room without hanging forever. */
const STREAM_TIMEOUT_MS = 300_000;

interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function networkError(provider: string, e: unknown): AIError {
  const aborted = (e as Error).name === "AbortError";
  return new AIError(
    aborted ? `${provider} request timed out` : `${provider} network error: ${(e as Error).message}`,
    aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
    true,
    provider,
  );
}

function parseBody(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}

async function post(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: RequestOptions,
  timeoutMs: number,
): Promise<{ res: Response; done: () => void }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
  opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { res, done: () => clearTimeout(timer) };
  } catch (e) {
    clearTimeout(timer);
    throw networkError(provider, e);
  }
}

export async function postJson<T>(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: RequestOptions = {},
): Promise<T> {
  const { res, done } = await post(provider, url, body, headers, opts, DEFAULT_TIMEOUT_MS);
  done();
  const data = parseBody(await res.text());
  if (!res.ok) throw AIError.fromHttp(provider, res.status, data);
  return data as T;
}

/**
 * POSTs and reads the reply as Server-Sent Events, handing every `data:`
 * payload to `onData` as it arrives. A handler may throw to abort the stream
 * with its own error; that error is passed through untouched.
 */
export async function postSse(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  onData: (data: unknown) => void,
  opts: RequestOptions = {},
): Promise<void> {
  const { res, done } = await post(provider, url, body, { accept: "text/event-stream", ...headers }, opts, STREAM_TIMEOUT_MS);
  try {
    if (!res.ok) throw AIError.fromHttp(provider, res.status, parseBody(await res.text()));
    if (!res.body) throw new AIError(`${provider} returned no stream body`, "PROVIDER_UNAVAILABLE", true, provider);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        throw networkError(provider, e);
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = message
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data && data !== "[DONE]") {
          let parsed: unknown;
          let ok = true;
          try {
            parsed = JSON.parse(data);
          } catch {
            ok = false;
          }
          if (ok) onData(parsed);
        }
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    done();
  }
}

export async function getJson<T>(provider: string, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw AIError.fromHttp(provider, res.status, data);
  return data as T;
}
