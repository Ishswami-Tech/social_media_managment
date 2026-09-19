import { AIError } from "./errors";

export async function postJson<T>(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as Error).name === "AbortError";
    throw new AIError(
      aborted ? `${provider} request timed out` : `${provider} network error: ${(e as Error).message}`,
      aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
      true,
      provider,
    );
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) throw AIError.fromHttp(provider, res.status, data);
  return data as T;
}

export async function getJson<T>(provider: string, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw AIError.fromHttp(provider, res.status, data);
  return data as T;
}
