export type AIErrorCode =
  "AUTH" | "RATE_LIMITED" | "CONTENT_FILTERED" | "INVALID_REQUEST" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";

const RETIRED_MODEL_RE =
  /no longer available|not available to new users|has been (retired|deprecated|shut down)|is deprecated|model .* not found|does not exist|(function|tool) calling is not (enabled|supported)|does not support (tools|function|json)|unsupported (model|tool)/i;

export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: AIErrorCode,
    public readonly retryable: boolean,
    public readonly provider?: string,
    public readonly status?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "AIError";
  }

  static fromHttp(provider: string, status: number, body: unknown): AIError {
    const message = messageFrom(body) ?? `${provider} request failed with ${status}`;
    if (status === 401 || status === 403) return new AIError(message, "AUTH", false, provider, status, body);
    if (status === 429) return new AIError(message, "RATE_LIMITED", true, provider, status, body);
    // A model that was withdrawn or is closed to this account: another model or provider can take the call.
    if (RETIRED_MODEL_RE.test(message)) return new AIError(message, "PROVIDER_UNAVAILABLE", true, provider, status, body);
    if (status === 408 || status === 504) return new AIError(message, "TIMEOUT", true, provider, status, body);
    if (status >= 500) return new AIError(message, "PROVIDER_UNAVAILABLE", true, provider, status, body);
    if (/safety|content_policy|blocked|filtered/i.test(message))
      return new AIError(message, "CONTENT_FILTERED", false, provider, status, body);
    return new AIError(message, "INVALID_REQUEST", false, provider, status, body);
  }
}

function messageFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 500) : undefined;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (err && typeof err === "object" && typeof (err as Record<string, unknown>).message === "string")
    return (err as Record<string, unknown>).message as string;
  if (typeof err === "string") return err;
  if (typeof b.message === "string") return b.message;
  return undefined;
}
