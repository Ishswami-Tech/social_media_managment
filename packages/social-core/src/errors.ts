/**
 * Error taxonomy shared by all adapters and the publish worker. The worker
 * decides whether to retry based on `retryable`, never on string matching.
 */
export type ProviderErrorCode =
  | "AUTH_EXPIRED" // token expired and refresh failed -> account needs reconnect
  | "PERMISSION_DENIED" // missing scope / not admin of page
  | "INVALID_CONTENT" // text too long, unsupported media, policy violation
  | "INVALID_MEDIA"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE" // 5xx / network
  | "DUPLICATE" // provider rejected as duplicate -> treat as success if we can resolve id
  | "NOT_FOUND"
  | "ACCOUNT_DISCONNECTED"
  | "UNKNOWN";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly raw?: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  static fromHttp(status: number, body: unknown, fallback = "Provider request failed"): ProviderError {
    const message = extractMessage(body) ?? fallback;
    if (status === 401) return new ProviderError(message, "AUTH_EXPIRED", false, status, body);
    if (status === 403) return new ProviderError(message, "PERMISSION_DENIED", false, status, body);
    if (status === 404) return new ProviderError(message, "NOT_FOUND", false, status, body);
    if (status === 429) return new ProviderError(message, "RATE_LIMITED", true, status, body, 60_000);
    if (status >= 500) return new ProviderError(message, "PROVIDER_UNAVAILABLE", true, status, body);
    if (status >= 400) return new ProviderError(message, "INVALID_CONTENT", false, status, body);
    return new ProviderError(message, "UNKNOWN", false, status, body);
  }
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return typeof body === "string" ? body : undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.message === "string") return b.message;
  if (b.error && typeof b.error === "object" && typeof (b.error as Record<string, unknown>).message === "string") {
    return (b.error as Record<string, unknown>).message as string;
  }
  if (typeof b.error_description === "string") return b.error_description;
  if (typeof b.error === "string") return b.error;
  return undefined;
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  // Network-level failures (fetch throws) are transient.
  if (err instanceof TypeError && /fetch|network|ECONN|ETIMEDOUT/i.test(err.message)) return true;
  return false;
}

/** Errors that mean the account must be reconnected (worker moves the post to DISCONNECTED_ACCOUNT). */
export function isDisconnectError(err: unknown): boolean {
  return err instanceof ProviderError && (err.code === "AUTH_EXPIRED" || err.code === "ACCOUNT_DISCONNECTED");
}
