import { ProviderError } from "./errors";

export interface JsonRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** send as application/x-www-form-urlencoded */
  form?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Small fetch wrapper used by adapters: JSON in/out, timeouts, and uniform
 * ProviderError mapping. Never logs request bodies (they may contain tokens).
 */
export async function requestJson<T = unknown>(url: string, init: JsonRequestInit = {}): Promise<T> {
  const { body, form, timeoutMs = 30_000, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const h = new Headers(headers);
  let payload: BodyInit | undefined;
  if (form) {
    h.set("content-type", "application/x-www-form-urlencoded");
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    h.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: h, body: payload, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new ProviderError(
      `Network error calling ${new URL(url).host}: ${(e as Error).message}`,
      "PROVIDER_UNAVAILABLE",
      true,
    );
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = ProviderError.fromHttp(res.status, data);
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter && err.code === "RATE_LIMITED") {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) Object.assign(err, { retryAfterMs: secs * 1000 });
    }
    throw err;
  }
  return data as T;
}
